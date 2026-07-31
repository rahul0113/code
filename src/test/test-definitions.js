import { runAceCompatibilityTests } from "./ace.test";
import { runAiTests } from "./ai.tests";
import { runCodeMirrorTests } from "./editor.tests";
import { runExecutorTests } from "./exec.tests";
import { runFsTests } from "./fs.tests";
import { runLspTests } from "./lsp.tests";
import { runSanityTests } from "./sanity.tests";
import { runUrlTests } from "./url.tests";

/**
 * Register Acode test suites here.
 * these are just functions that runs tests by creating a instance of TestRunner
 */
export const testDefinitions = [
	runSanityTests,
	runAiTests,
	runExecutorTests,
	runUrlTests,
	runFsTests,
	runLspTests,
	runCodeMirrorTests,
	runAceCompatibilityTests,
];
