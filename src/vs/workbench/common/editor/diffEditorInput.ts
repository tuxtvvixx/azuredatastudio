/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { AbstractSideBySideEditorInputSerializer, SideBySideEditorInput } from 'vs/workbench/common/editor/sideBySideEditorInput';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { EditorModel } from 'vs/workbench/common/editor/editorModel';
import { TEXT_DIFF_EDITOR_ID, BINARY_DIFF_EDITOR_ID, Verbosity, IEditorDescriptor, IEditorPane, GroupIdentifier, IResourceDiffEditorInput, IUntypedEditorInput, isResourceDiffEditorInput, IDiffEditorInput, IResourceSideBySideEditorInput, EditorInputCapabilities } from 'vs/workbench/common/editor';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { DiffEditorModel } from 'vs/workbench/common/editor/diffEditorModel';
import { TextDiffEditorModel } from 'vs/workbench/common/editor/textDiffEditorModel';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { shorten } from 'vs/base/common/labels';

interface IDiffEditorInputLabels {
	name: string;

	shortDescription: string | undefined;
	mediumDescription: string | undefined;
	longDescription: string | undefined;

	forceDescription: boolean;

	shortTitle: string;
	mediumTitle: string;
	longTitle: string;
}

/**
 * The base editor input for the diff editor. It is made up of two editor inputs, the original version
 * and the modified version.
 */
export class DiffEditorInput extends SideBySideEditorInput implements IDiffEditorInput {

	static override readonly ID: string = 'workbench.editors.diffEditorInput';

	override get typeId(): string {
		return DiffEditorInput.ID;
	}

	override get editorId(): string | undefined {
		return this.modified.editorId === this.original.editorId ? this.modified.editorId : undefined;
	}

	override get capabilities(): EditorInputCapabilities {
		let capabilities = super.capabilities;

		// Force description capability depends on labels
		if (this.labels.forceDescription) {
			capabilities |= EditorInputCapabilities.ForceDescription;
		}

		return capabilities;
	}

	private cachedModel: DiffEditorModel | undefined = undefined;

	private readonly labels = this.computeLabels();

	constructor(
		preferredName: string | undefined,
		preferredDescription: string | undefined,
		readonly original: EditorInput,
		readonly modified: EditorInput,
		private readonly forceOpenAsBinary: boolean | undefined,
		@IEditorService editorService: IEditorService
	) {
		super(preferredName, preferredDescription, original, modified, editorService);
	}

	private computeLabels(): IDiffEditorInputLabels {

		// Name
		let name: string;
		let forceDescription = false;
		if (this.preferredName) {
			name = this.preferredName;
		} else {
			const originalName = this.original.getName();
			const modifiedName = this.modified.getName();

			name = localize('sideBySideLabels', "{0} ↔ {1}", originalName, modifiedName);

			// Enforce description when the names are identical
			forceDescription = originalName === modifiedName;
		}

		// Description
		let shortDescription: string | undefined;
		let mediumDescription: string | undefined;
		let longDescription: string | undefined;
		if (this.preferredDescription) {
			shortDescription = this.preferredDescription;
			mediumDescription = this.preferredDescription;
			longDescription = this.preferredDescription;
		} else {
			shortDescription = this.computeLabel(this.original.getDescription(Verbosity.SHORT), this.modified.getDescription(Verbosity.SHORT));
			longDescription = this.computeLabel(this.original.getDescription(Verbosity.LONG), this.modified.getDescription(Verbosity.LONG));

			// Medium Description: try to be verbose by computing
			// a label that resembles the difference between the two
			const originalMediumDescription = this.original.getDescription(Verbosity.MEDIUM);
			const modifiedMediumDescription = this.modified.getDescription(Verbosity.MEDIUM);
			if (
				(typeof originalMediumDescription === 'string' && typeof modifiedMediumDescription === 'string') && // we can only `shorten` when both sides are strings...
				(originalMediumDescription || modifiedMediumDescription) 											// ...however never when both sides are empty strings
			) {
				const [shortenedOriginalMediumDescription, shortenedModifiedMediumDescription] = shorten([originalMediumDescription, modifiedMediumDescription]);
				mediumDescription = this.computeLabel(shortenedOriginalMediumDescription, shortenedModifiedMediumDescription);
			}
		}

		// Title
		const shortTitle = this.computeLabel(this.original.getTitle(Verbosity.SHORT) ?? this.original.getName(), this.modified.getTitle(Verbosity.SHORT) ?? this.modified.getName(), ' ↔ ');
		const mediumTitle = this.computeLabel(this.original.getTitle(Verbosity.MEDIUM) ?? this.original.getName(), this.modified.getTitle(Verbosity.MEDIUM) ?? this.modified.getName(), ' ↔ ');
		const longTitle = this.computeLabel(this.original.getTitle(Verbosity.LONG) ?? this.original.getName(), this.modified.getTitle(Verbosity.LONG) ?? this.modified.getName(), ' ↔ ');

		return { name, shortDescription, mediumDescription, longDescription, forceDescription, shortTitle, mediumTitle, longTitle };
	}

	private computeLabel(originalLabel: string, modifiedLabel: string, separator?: string): string;
	private computeLabel(originalLabel: string | undefined, modifiedLabel: string | undefined, separator?: string): string | undefined;
	private computeLabel(originalLabel: string | undefined, modifiedLabel: string | undefined, separator = ' - '): string | undefined {
		if (!originalLabel || !modifiedLabel) {
			return undefined;
		}

		if (originalLabel === modifiedLabel) {
			return modifiedLabel;
		}

		return `${originalLabel}${separator}${modifiedLabel}`;
	}

	override getName(): string {
		return this.labels.name;
	}

	override getDescription(verbosity = Verbosity.MEDIUM): string | undefined {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.labels.shortDescription;
			case Verbosity.LONG:
				return this.labels.longDescription;
			case Verbosity.MEDIUM:
			default:
				return this.labels.mediumDescription;
		}
	}

	override getTitle(verbosity?: Verbosity): string {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.labels.shortTitle;
			case Verbosity.LONG:
				return this.labels.longTitle;
			default:
			case Verbosity.MEDIUM:
				return this.labels.mediumTitle;
		}
	}

	override async resolve(): Promise<EditorModel> {

		// Create Model - we never reuse our cached model if refresh is true because we cannot
		// decide for the inputs within if the cached model can be reused or not. There may be
		// inputs that need to be loaded again and thus we always recreate the model and dispose
		// the previous one - if any.
		const resolvedModel = await this.createModel();
		if (this.cachedModel) {
			this.cachedModel.dispose();
		}

		this.cachedModel = resolvedModel;

		return this.cachedModel;
	}

	override prefersEditorPane<T extends IEditorDescriptor<IEditorPane>>(editorPanes: T[]): T | undefined {
		if (this.forceOpenAsBinary) {
			return editorPanes.find(editorPane => editorPane.typeId === BINARY_DIFF_EDITOR_ID);
		}

		return editorPanes.find(editorPane => editorPane.typeId === TEXT_DIFF_EDITOR_ID);
	}

	private async createModel(): Promise<DiffEditorModel> {

		// Join resolve call over two inputs and build diff editor model
		const [originalEditorModel, modifiedEditorModel] = await Promise.all([
			this.original.resolve(),
			this.modified.resolve()
		]);

		// If both are text models, return textdiffeditor model
		if (modifiedEditorModel instanceof BaseTextEditorModel && originalEditorModel instanceof BaseTextEditorModel) {
			return new TextDiffEditorModel(originalEditorModel, modifiedEditorModel);
		}

		// Otherwise return normal diff model
		return new DiffEditorModel(withNullAsUndefined(originalEditorModel), withNullAsUndefined(modifiedEditorModel));
	}

	override toUntyped(options?: { preserveViewState: GroupIdentifier }): (IResourceDiffEditorInput & IResourceSideBySideEditorInput) | undefined {
		const untyped = super.toUntyped(options);
		if (untyped) {
			return {
				...untyped,
				modified: untyped.primary,
				original: untyped.secondary
			};
		}

		return undefined;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (this === otherInput) {
			return true;
		}

		if (otherInput instanceof DiffEditorInput) {
			return this.modified.matches(otherInput.modified) && this.original.matches(otherInput.original) && otherInput.forceOpenAsBinary === this.forceOpenAsBinary;
		}

		if (isResourceDiffEditorInput(otherInput)) {
			return this.modified.matches(otherInput.modified) && this.original.matches(otherInput.original);
		}

		return false;
	}

	override dispose(): void {

		// Free the diff editor model but do not propagate the dispose() call to the two inputs
		// We never created the two inputs (original and modified) so we can not dispose
		// them without sideeffects.
		if (this.cachedModel) {
			this.cachedModel.dispose();
			this.cachedModel = undefined;
		}

		super.dispose();
	}
}

export class DiffEditorInputSerializer extends AbstractSideBySideEditorInputSerializer {

	protected createEditorInput(instantiationService: IInstantiationService, name: string | undefined, description: string | undefined, secondaryInput: EditorInput, primaryInput: EditorInput): EditorInput {
		return instantiationService.createInstance(DiffEditorInput, name, description, secondaryInput, primaryInput, undefined);
	}
}
