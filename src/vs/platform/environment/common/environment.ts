/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { createDecorator, refineServiceDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IEnvironmentService = createDecorator<IEnvironmentService>('environmentService');
export const INativeEnvironmentService = refineServiceDecorator<IEnvironmentService, INativeEnvironmentService>(IEnvironmentService);

export interface IDebugParams {
	port: number | null;
	break: boolean;
}

export interface IExtensionHostDebugParams extends IDebugParams {
	debugId?: string;
	env?: Record<string, string>;
}

/**
 * Type of extension.
 *
 * **NOTE**: This is defined in `platform/environment` because it can appear as a CLI argument.
 */
export type ExtensionKind = 'ui' | 'workspace' | 'web';

/**
 * A basic environment service that can be used in various processes,
 * such as main, renderer and shared process. Use subclasses of this
 * service for specific environment.
 */
export interface IEnvironmentService {

	readonly _serviceBrand: undefined;

	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
	//
	// NOTE: KEEP THIS INTERFACE AS SMALL AS POSSIBLE.
	//
	// AS SUCH:
	//   - PUT NON-WEB PROPERTIES INTO NATIVE ENVIRONMENT SERVICE
	//   - PUT WORKBENCH ONLY PROPERTIES INTO WORKBENCH ENVIRONMENT SERVICE
	//   - PUT ELECTRON-MAIN ONLY PROPERTIES INTO MAIN ENVIRONMENT SERVICE
	//
	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

	// --- user roaming data
	userRoamingDataHome: URI;
	settingsResource: URI;
	keybindingsResource: URI;
	keyboardLayoutResource: URI;
	argvResource: URI;
	snippetsHome: URI;

	// --- data paths
	untitledWorkspacesHome: URI;
	globalStorageHome: URI;
	workspaceStorageHome: URI;
	localHistoryHome: URI;
	cacheHome: URI;

	// --- settings sync
	userDataSyncHome: URI;
	userDataSyncLogResource: URI;
	sync: 'on' | 'off' | undefined;

	// --- extension development
	debugExtensionHost: IExtensionHostDebugParams;
	isExtensionDevelopment: boolean;
	disableExtensions: boolean | string[];
	enableExtensions?: readonly string[];
	extensionDevelopmentLocationURI?: URI[];
	extensionDevelopmentKind?: ExtensionKind[];
	extensionTestsLocationURI?: URI;

	// --- logging
	logsPath: string;
	logLevel?: string;
	verbose: boolean;
	isBuilt: boolean;

	// --- telemetry
	disableTelemetry: boolean;
	telemetryLogResource: URI;
	serviceMachineIdResource: URI;

	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
	//
	// NOTE: KEEP THIS INTERFACE AS SMALL AS POSSIBLE.
	//
	// AS SUCH:
	//   - PUT NON-WEB PROPERTIES INTO NATIVE ENVIRONMENT SERVICE
	//   - PUT WORKBENCH ONLY PROPERTIES INTO WORKBENCH ENVIRONMENT SERVICE
	//   - PUT ELECTRON-MAIN ONLY PROPERTIES INTO MAIN ENVIRONMENT SERVICE
	//
	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
}

/**
 * A subclass of the `IEnvironmentService` to be used only in native
 * environments (Windows, Linux, macOS) but not e.g. web.
 */
export interface INativeEnvironmentService extends IEnvironmentService {

	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
	//
	// NOTE: KEEP THIS INTERFACE AS SMALL AS POSSIBLE.
	//
	// AS SUCH:
	//   - PUT WORKBENCH ONLY PROPERTIES INTO WORKBENCH ENVIRONMENT SERVICE
	//   - PUT ELECTRON-MAIN ONLY PROPERTIES INTO MAIN ENVIRONMENT SERVICE
	//
	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

	// --- CLI Arguments
	args: NativeParsedArgs;

	// --- data paths
	appRoot: string;
	userHome: URI;
	appSettingsHome: URI;
	tmpDir: URI;
	userDataPath: string;
	machineSettingsResource: URI;
	installSourcePath: string;

	// --- extensions
	extensionsPath: string;
	extensionsDownloadPath: string;
	builtinExtensionsPath: string;

	// --- use keytar for credentials
	disableKeytar?: boolean;

	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
	//
	// NOTE: KEEP THIS INTERFACE AS SMALL AS POSSIBLE.
	//
	// AS SUCH:
	//   - PUT NON-WEB PROPERTIES INTO NATIVE ENVIRONMENT SERVICE
	//   - PUT WORKBENCH ONLY PROPERTIES INTO WORKBENCH ENVIRONMENT SERVICE
	//   - PUT ELECTRON-MAIN ONLY PROPERTIES INTO MAIN ENVIRONMENT SERVICE
	//
	// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
}
