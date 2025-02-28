/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModelContentProvider, ITextModelService } from 'vs/editor/common/services/resolverService';
import { URI } from 'vs/base/common/uri';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IModelService } from 'vs/editor/common/services/model';
import { createTextBufferFactoryFromSnapshot } from 'vs/editor/common/model/textModel';
import { WorkspaceEditMetadata } from 'vs/editor/common/languages';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { coalesceInPlace } from 'vs/base/common/arrays';
import { Range } from 'vs/editor/common/core/range';
import { EditOperation, ISingleEditOperation } from 'vs/editor/common/core/editOperation';
import { ServicesAccessor, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IFileService } from 'vs/platform/files/common/files';
import { Emitter, Event } from 'vs/base/common/event';
import { ConflictDetector } from 'vs/workbench/contrib/bulkEdit/browser/conflicts';
import { ResourceMap } from 'vs/base/common/map';
import { localize } from 'vs/nls';
import { extUri } from 'vs/base/common/resources';
import { ResourceEdit, ResourceFileEdit, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { Codicon } from 'vs/base/common/codicons';
import { generateUuid } from 'vs/base/common/uuid';

export class CheckedStates<T extends object> {

	private readonly _states = new WeakMap<T, boolean>();
	private _checkedCount: number = 0;

	private readonly _onDidChange = new Emitter<T>();
	readonly onDidChange: Event<T> = this._onDidChange.event;

	dispose(): void {
		this._onDidChange.dispose();
	}

	get checkedCount() {
		return this._checkedCount;
	}

	isChecked(obj: T): boolean {
		return this._states.get(obj) ?? false;
	}

	updateChecked(obj: T, value: boolean): void {
		const valueNow = this._states.get(obj);
		if (valueNow === value) {
			return;
		}
		if (valueNow === undefined) {
			if (value) {
				this._checkedCount += 1;
			}
		} else {
			if (value) {
				this._checkedCount += 1;
			} else {
				this._checkedCount -= 1;
			}
		}
		this._states.set(obj, value);
		this._onDidChange.fire(obj);
	}
}

export class BulkTextEdit {

	constructor(
		readonly parent: BulkFileOperation,
		readonly textEdit: ResourceTextEdit
	) { }
}

export const enum BulkFileOperationType {
	TextEdit = 1,
	Create = 2,
	Delete = 4,
	Rename = 8,
}

export class BulkFileOperation {

	type: BulkFileOperationType = 0;
	textEdits: BulkTextEdit[] = [];
	originalEdits = new Map<number, ResourceTextEdit | ResourceFileEdit>();
	newUri?: URI;

	constructor(
		readonly uri: URI,
		readonly parent: BulkFileOperations
	) { }

	addEdit(index: number, type: BulkFileOperationType, edit: ResourceTextEdit | ResourceFileEdit) {
		this.type |= type;
		this.originalEdits.set(index, edit);
		if (edit instanceof ResourceTextEdit) {
			this.textEdits.push(new BulkTextEdit(this, edit));

		} else if (type === BulkFileOperationType.Rename) {
			this.newUri = edit.newResource;
		}
	}

	needsConfirmation(): boolean {
		for (let [, edit] of this.originalEdits) {
			if (!this.parent.checked.isChecked(edit)) {
				return true;
			}
		}
		return false;
	}
}

export class BulkCategory {

	private static readonly _defaultMetadata = Object.freeze({
		label: localize('default', "Other"),
		icon: Codicon.symbolFile,
		needsConfirmation: false
	});

	static keyOf(metadata?: WorkspaceEditMetadata) {
		return metadata?.label || '<default>';
	}

	readonly operationByResource = new Map<string, BulkFileOperation>();

	constructor(readonly metadata: WorkspaceEditMetadata = BulkCategory._defaultMetadata) { }

	get fileOperations(): IterableIterator<BulkFileOperation> {
		return this.operationByResource.values();
	}
}

export class BulkFileOperations {

	static async create(accessor: ServicesAccessor, bulkEdit: ResourceEdit[]): Promise<BulkFileOperations> {
		const result = accessor.get(IInstantiationService).createInstance(BulkFileOperations, bulkEdit);
		return await result._init();
	}

	readonly checked = new CheckedStates<ResourceEdit>();

	readonly fileOperations: BulkFileOperation[] = [];
	readonly categories: BulkCategory[] = [];
	readonly conflicts: ConflictDetector;

	constructor(
		private readonly _bulkEdit: ResourceEdit[],
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService instaService: IInstantiationService,
	) {
		this.conflicts = instaService.createInstance(ConflictDetector, _bulkEdit);
	}

	dispose(): void {
		this.checked.dispose();
		this.conflicts.dispose();
	}

	async _init() {
		const operationByResource = new Map<string, BulkFileOperation>();
		const operationByCategory = new Map<string, BulkCategory>();

		const newToOldUri = new ResourceMap<URI>();

		for (let idx = 0; idx < this._bulkEdit.length; idx++) {
			const edit = this._bulkEdit[idx];

			let uri: URI;
			let type: BulkFileOperationType;

			// store inital checked state
			this.checked.updateChecked(edit, !edit.metadata?.needsConfirmation);

			if (edit instanceof ResourceTextEdit) {
				type = BulkFileOperationType.TextEdit;
				uri = edit.resource;

			} else if (edit instanceof ResourceFileEdit) {
				if (edit.newResource && edit.oldResource) {
					type = BulkFileOperationType.Rename;
					uri = edit.oldResource;
					if (edit.options?.overwrite === undefined && edit.options?.ignoreIfExists && await this._fileService.exists(uri)) {
						// noop -> "soft" rename to something that already exists
						continue;
					}
					// map newResource onto oldResource so that text-edit appear for
					// the same file element
					newToOldUri.set(edit.newResource, uri);

				} else if (edit.oldResource) {
					type = BulkFileOperationType.Delete;
					uri = edit.oldResource;
					if (edit.options?.ignoreIfNotExists && !await this._fileService.exists(uri)) {
						// noop -> "soft" delete something that doesn't exist
						continue;
					}

				} else if (edit.newResource) {
					type = BulkFileOperationType.Create;
					uri = edit.newResource;
					if (edit.options?.overwrite === undefined && edit.options?.ignoreIfExists && await this._fileService.exists(uri)) {
						// noop -> "soft" create something that already exists
						continue;
					}

				} else {
					// invalid edit -> skip
					continue;
				}

			} else {
				// unsupported edit
				continue;
			}

			const insert = (uri: URI, map: Map<string, BulkFileOperation>) => {
				let key = extUri.getComparisonKey(uri, true);
				let operation = map.get(key);

				// rename
				if (!operation && newToOldUri.has(uri)) {
					uri = newToOldUri.get(uri)!;
					key = extUri.getComparisonKey(uri, true);
					operation = map.get(key);
				}

				if (!operation) {
					operation = new BulkFileOperation(uri, this);
					map.set(key, operation);
				}
				operation.addEdit(idx, type, edit);
			};

			insert(uri, operationByResource);

			// insert into "this" category
			let key = BulkCategory.keyOf(edit.metadata);
			let category = operationByCategory.get(key);
			if (!category) {
				category = new BulkCategory(edit.metadata);
				operationByCategory.set(key, category);
			}
			insert(uri, category.operationByResource);
		}

		operationByResource.forEach(value => this.fileOperations.push(value));
		operationByCategory.forEach(value => this.categories.push(value));

		// "correct" invalid parent-check child states that is
		// unchecked file edits (rename, create, delete) uncheck
		// all edits for a file, e.g no text change without rename
		for (let file of this.fileOperations) {
			if (file.type !== BulkFileOperationType.TextEdit) {
				let checked = true;
				for (const edit of file.originalEdits.values()) {
					if (edit instanceof ResourceFileEdit) {
						checked = checked && this.checked.isChecked(edit);
					}
				}
				if (!checked) {
					for (const edit of file.originalEdits.values()) {
						this.checked.updateChecked(edit, checked);
					}
				}
			}
		}

		// sort (once) categories atop which have unconfirmed edits
		this.categories.sort((a, b) => {
			if (a.metadata.needsConfirmation === b.metadata.needsConfirmation) {
				return a.metadata.label.localeCompare(b.metadata.label);
			} else if (a.metadata.needsConfirmation) {
				return -1;
			} else {
				return 1;
			}
		});

		return this;
	}

	getWorkspaceEdit(): ResourceEdit[] {
		const result: ResourceEdit[] = [];
		let allAccepted = true;

		for (let i = 0; i < this._bulkEdit.length; i++) {
			const edit = this._bulkEdit[i];
			if (this.checked.isChecked(edit)) {
				result[i] = edit;
				continue;
			}
			allAccepted = false;
		}

		if (allAccepted) {
			return this._bulkEdit;
		}

		// not all edits have been accepted
		coalesceInPlace(result);
		return result;
	}

	getFileEdits(uri: URI): ISingleEditOperation[] {

		for (let file of this.fileOperations) {
			if (file.uri.toString() === uri.toString()) {

				const result: ISingleEditOperation[] = [];
				let ignoreAll = false;

				for (const edit of file.originalEdits.values()) {
					if (edit instanceof ResourceTextEdit) {
						if (this.checked.isChecked(edit)) {
							result.push(EditOperation.replaceMove(Range.lift(edit.textEdit.range), edit.textEdit.text));
						}

					} else if (!this.checked.isChecked(edit)) {
						// UNCHECKED WorkspaceFileEdit disables all text edits
						ignoreAll = true;
					}
				}

				if (ignoreAll) {
					return [];
				}

				return result.sort((a, b) => Range.compareRangesUsingStarts(a.range, b.range));
			}
		}
		return [];
	}

	getUriOfEdit(edit: ResourceEdit): URI {
		for (let file of this.fileOperations) {
			for (const value of file.originalEdits.values()) {
				if (value === edit) {
					return file.uri;
				}
			}
		}
		throw new Error('invalid edit');
	}
}

export class BulkEditPreviewProvider implements ITextModelContentProvider {

	static readonly Schema = 'vscode-bulkeditpreview';

	static emptyPreview = URI.from({ scheme: BulkEditPreviewProvider.Schema, fragment: 'empty' });


	static fromPreviewUri(uri: URI): URI {
		return URI.parse(uri.query);
	}

	private readonly _disposables = new DisposableStore();
	private readonly _ready: Promise<any>;
	private readonly _modelPreviewEdits = new Map<string, ISingleEditOperation[]>();
	private readonly _instanceId = generateUuid();

	constructor(
		private readonly _operations: BulkFileOperations,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IModelService private readonly _modelService: IModelService,
		@ITextModelService private readonly _textModelResolverService: ITextModelService
	) {
		this._disposables.add(this._textModelResolverService.registerTextModelContentProvider(BulkEditPreviewProvider.Schema, this));
		this._ready = this._init();
	}

	dispose(): void {
		this._disposables.dispose();
	}

	asPreviewUri(uri: URI): URI {
		return URI.from({ scheme: BulkEditPreviewProvider.Schema, authority: this._instanceId, path: uri.path, query: uri.toString() });
	}

	private async _init() {
		for (let operation of this._operations.fileOperations) {
			await this._applyTextEditsToPreviewModel(operation.uri);
		}
		this._disposables.add(this._operations.checked.onDidChange(e => {
			const uri = this._operations.getUriOfEdit(e);
			this._applyTextEditsToPreviewModel(uri);
		}));
	}

	private async _applyTextEditsToPreviewModel(uri: URI) {
		const model = await this._getOrCreatePreviewModel(uri);

		// undo edits that have been done before
		let undoEdits = this._modelPreviewEdits.get(model.id);
		if (undoEdits) {
			model.applyEdits(undoEdits);
		}
		// apply new edits and keep (future) undo edits
		const newEdits = this._operations.getFileEdits(uri);
		const newUndoEdits = model.applyEdits(newEdits, true);
		this._modelPreviewEdits.set(model.id, newUndoEdits);
	}

	private async _getOrCreatePreviewModel(uri: URI) {
		const previewUri = this.asPreviewUri(uri);
		let model = this._modelService.getModel(previewUri);
		if (!model) {
			try {
				// try: copy existing
				const ref = await this._textModelResolverService.createModelReference(uri);
				const sourceModel = ref.object.textEditorModel;
				model = this._modelService.createModel(
					createTextBufferFactoryFromSnapshot(sourceModel.createSnapshot()),
					this._languageService.createById(sourceModel.getLanguageId()),
					previewUri
				);
				ref.dispose();

			} catch {
				// create NEW model
				model = this._modelService.createModel(
					'',
					this._languageService.createByFilepathOrFirstLine(previewUri),
					previewUri
				);
			}
			// this is a little weird but otherwise editors and other cusomers
			// will dispose my models before they should be disposed...
			// And all of this is off the eventloop to prevent endless recursion
			queueMicrotask(async () => {
				this._disposables.add(await this._textModelResolverService.createModelReference(model!.uri));
			});
		}
		return model;
	}

	async provideTextContent(previewUri: URI) {
		if (previewUri.toString() === BulkEditPreviewProvider.emptyPreview.toString()) {
			return this._modelService.createModel('', null, previewUri);
		}
		await this._ready;
		return this._modelService.getModel(previewUri);
	}
}
