/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WorkspaceTreeDataProvider } from './common/workspaceTreeDataProvider';
import { WorkspaceService } from './services/workspaceService';
import { WorkspaceTreeItem, IExtension } from 'dataworkspace';
import { DataWorkspaceExtension } from './common/dataWorkspaceExtension';
import { NewProjectDialog } from './dialogs/newProjectDialog';
import { browseForProject, OpenExistingDialog } from './dialogs/openExistingDialog';
import { IWorkspaceService } from './common/interfaces';
import { IconPathHelper } from './common/iconHelper';
import { ProjectDashboard } from './dialogs/projectDashboard';
import { getAzdataApi } from './common/utils';
import { createNewProjectWithQuickpick } from './dialogs/newProjectQuickpick';
import Logger from './common/logger';

export async function activate(context: vscode.ExtensionContext): Promise<IExtension> {
	const startTime = new Date().getTime();
	Logger.log(`Starting Data Workspace activate()`);

	const azDataApiStartTime = new Date().getTime();
	const azdataApi = getAzdataApi();
	void vscode.commands.executeCommand('setContext', 'azdataAvailable', !!azdataApi);
	Logger.log(`Setting azdataAvailable took ${new Date().getTime() - azDataApiStartTime}ms`);

	const workspaceServiceConstructorStartTime = new Date().getTime();
	const workspaceService = new WorkspaceService();
	Logger.log(`WorkspaceService constructor took ${new Date().getTime() - workspaceServiceConstructorStartTime}ms`);

	const workspaceTreeDataProviderStartTime = new Date().getTime();
	const workspaceTreeDataProvider = new WorkspaceTreeDataProvider(workspaceService);
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(async () => {
		await workspaceTreeDataProvider.refresh();
	}));
	Logger.log(`WorkspaceTreeDataProvider constructor took ${new Date().getTime() - workspaceTreeDataProviderStartTime}ms`);

	const dataWorkspaceExtensionStartTime = new Date().getTime();
	const dataWorkspaceExtension = new DataWorkspaceExtension(workspaceService);
	Logger.log(`DataWorkspaceExtension constructor took ${new Date().getTime() - dataWorkspaceExtensionStartTime}ms`);

	const registerTreeDataProvidertartTime = new Date().getTime();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('dataworkspace.views.main', workspaceTreeDataProvider));
	Logger.log(`registerTreeDataProvider took ${new Date().getTime() - registerTreeDataProvidertartTime}ms`);

	const settingProjectProviderContextStartTime = new Date().getTime();
	context.subscriptions.push(vscode.extensions.onDidChange(() => {
		setProjectProviderContextValue(workspaceService);
	}));
	setProjectProviderContextValue(workspaceService);
	Logger.log(`setProjectProviderContextValue took ${new Date().getTime() - settingProjectProviderContextStartTime}ms`);

	const registerCommandStartTime = new Date().getTime();
	context.subscriptions.push(vscode.commands.registerCommand('projects.new', async () => {
		if (azdataApi) {
			const dialog = new NewProjectDialog(workspaceService);
			await dialog.open();
		} else {
			await createNewProjectWithQuickpick(workspaceService);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('projects.openExisting', async () => {
		if (azdataApi) {
			const dialog = new OpenExistingDialog(workspaceService);
			await dialog.open();
		} else {
			const projectFileUri = await browseForProject(workspaceService);
			if (!projectFileUri) {
				return;
			}
			await workspaceService.addProjectsToWorkspace([projectFileUri]);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dataworkspace.refresh', async () => {
		await workspaceTreeDataProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dataworkspace.close', () => {
		return vscode.commands.executeCommand('workbench.action.closeFolder');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('projects.removeProject', async (treeItem: WorkspaceTreeItem) => {
		await workspaceService.removeProject(vscode.Uri.file(treeItem.element.project.projectFilePath));
	}));

	context.subscriptions.push(vscode.commands.registerCommand('projects.manageProject', async (treeItem: WorkspaceTreeItem) => {
		const dashboard = new ProjectDashboard(workspaceService, treeItem);
		await dashboard.showDashboard();
	}));
	Logger.log(`Registering commands took ${new Date().getTime() - registerCommandStartTime}ms`);

	const iconPathHelperTime = new Date().getTime();
	IconPathHelper.setExtensionContext(context);
	Logger.log(`IconPathHelper took ${new Date().getTime() - iconPathHelperTime}ms`);

	Logger.log(`Finished activating Data Workspace extension. Total time = ${new Date().getTime() - startTime}ms`);
	return Promise.resolve(dataWorkspaceExtension);
}

function setProjectProviderContextValue(workspaceService: IWorkspaceService): void {
	void vscode.commands.executeCommand('setContext', 'isProjectProviderAvailable', workspaceService.isProjectProviderAvailable);
}

export function deactivate(): void {
}
