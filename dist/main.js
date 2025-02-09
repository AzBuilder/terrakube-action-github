"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const glob = __importStar(require("@actions/glob"));
const httpm = __importStar(require("@actions/http-client"));
const github = __importStar(require("@actions/github"));
const userInput_1 = require("./userInput");
const terrakube_1 = require("./terrakube");
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
function run() {
    var e_1, _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const githubActionInput = yield (0, userInput_1.getActionInput)();
            const terrakubeClient = new terrakube_1.TerrakubeClient(githubActionInput);
            const patterns = ['**/terrakube.json'];
            const globber = yield glob.create(patterns.join('\n'));
            core.info(`Changed Directory: ${githubActionInput.terrakubeFolder}`);
            try {
                for (var _b = __asyncValues(globber.globGenerator()), _c; _c = yield _b.next(), !_c.done;) {
                    const file = _c.value;
                    const terrakubeData = JSON.parse(yield (0, promises_1.readFile)(`${file}`, "utf8"));
                    const workspaceFolder = path_1.default.basename(path_1.default.dirname(file));
                    core.info(`Folder ${workspaceFolder} change: ${githubActionInput.terrakubeFolder.split(" ").indexOf(workspaceFolder)}`);
                    //Folder with terrakube.json file change
                    if (githubActionInput.terrakubeFolder.split(" ").indexOf(workspaceFolder) > -1) {
                        core.startGroup(`Execute Workspace ${workspaceFolder}`);
                        console.info(`Processing: ${file}`);
                        core.info(`Loaded JSON: ${JSON.stringify(terrakubeData)}`);
                        core.info(`Organization: ${githubActionInput.terrakubeOrganization}`);
                        core.info(`Workspace: ${workspaceFolder}`);
                        core.info(`Folder: /${workspaceFolder}`);
                        core.info(`Branch: ${githubActionInput.branch}`);
                        core.info(`Running Workspace ${workspaceFolder} with Template ${githubActionInput.terrakubeTemplate}`);
                        core.info(`Checking if workspace ${workspaceFolder}`);
                        const organizationId = yield terrakubeClient.getOrganizationId(githubActionInput.terrakubeOrganization);
                        if (organizationId !== "") {
                            let workspaceId = yield terrakubeClient.getWorkspaceId(organizationId, workspaceFolder);
                            if (workspaceId === "") {
                                core.info(`Creating new workspace ${workspaceFolder}`);
                                let sshId = "";
                                if (githubActionInput.terrakubeSshKeyName !== "") {
                                    core.info(`Searching SSH ${githubActionInput.terrakubeSshKeyName}`);
                                    sshId = yield terrakubeClient.getSshId(organizationId, githubActionInput.terrakubeSshKeyName);
                                    core.info(`Ssh Id: ${sshId}`);
                                }
                                workspaceId = yield terrakubeClient.createWorkspace(organizationId, workspaceFolder, terrakubeData.terraform, `/${workspaceFolder}`, githubActionInput.terrakubeRepository, githubActionInput.branch, sshId);
                            }
                            core.info(`Searching template ${githubActionInput.terrakubeTemplate}`);
                            const templateId = yield terrakubeClient.getTemplateId(organizationId, githubActionInput.terrakubeTemplate);
                            if (templateId !== "") {
                                core.info(`Using template id ${templateId}`);
                                core.info(`Creating new job: `);
                                const jobId = yield terrakubeClient.createJobId(organizationId, workspaceId, templateId);
                                yield checkTerrakubeLogs(terrakubeClient, githubActionInput.githubToken, organizationId, jobId, workspaceFolder, githubActionInput.showOutput);
                            }
                            else {
                                core.error(`Template not found: ${githubActionInput.terrakubeTemplate} in Organization: ${githubActionInput.terrakubeOrganization}`);
                            }
                        }
                        else {
                            core.error(`Organization not found: ${githubActionInput.terrakubeOrganization} in Endpoint: ${githubActionInput.terrakubeEndpoint}`);
                        }
                        core.endGroup();
                    }
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) yield _a.call(_b);
                }
                finally { if (e_1) throw e_1.error; }
            }
        }
        catch (error) {
            if (error instanceof Error)
                core.setFailed(error.message);
        }
    });
}
function sleep(ms) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise(resolve => setTimeout(resolve, ms));
    });
}
function checkTerrakubeLogs(terrakubeClient, githubToken, organizationId, jobId, workspaceFolder, show_output) {
    return __awaiter(this, void 0, void 0, function* () {
        let jobResponse = yield terrakubeClient.getJobData(organizationId, jobId);
        let jobResponseJson = JSON.parse(jobResponse);
        while (jobResponseJson.data.attributes.status !== "completed" && jobResponseJson.data.attributes.status !== "failed") {
            yield sleep(5000);
            jobResponse = yield terrakubeClient.getJobData(organizationId, jobId);
            jobResponseJson = JSON.parse(jobResponse);
            core.info("Waiting for job information...");
        }
        core.info(`${jobResponse}`);
        core.info(`${JSON.stringify(jobResponseJson.included)}`);
        const httpClient = new httpm.HttpClient(undefined, [], { ignoreSslError: true });
        const jobSteps = jobResponseJson.included;
        core.info(`Check - ${Object.keys(jobSteps).length}`);
        let finalComment = `## Workspace: ${workspaceFolder} Status: ${jobResponseJson.data.attributes.status.toUpperCase()} \n`;
        for (let index = 0; index < Object.keys(jobSteps).length; index++) {
            core.startGroup(`Running ${jobSteps[index].attributes.name}`);
            const response = yield httpClient.get(`${jobSteps[index].attributes.output}`, {
                'Authorization': `Bearer ${terrakubeClient.authenticationToken}`
            });
            let body = yield response.readBody();
            core.info("ANDREW BODY");
            core.info(body);
            core.endGroup();
            //const convert = new Convert();
            //const commentBody = `Logs from step: ${jobSteps[index].attributes.name} \`\`\`\n${convert.toHtml(body)}\n\`\`\` `
            if (show_output) {
                body = body.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                const commentBody = `\n ## Logs: ${jobSteps[index].attributes.name} status ${jobSteps[index].attributes.status} \n \`\`\`\n${body}\n\`\`\` `;
                finalComment = finalComment.concat(commentBody);
            }
        }
        if (show_output) {
            core.info("Setup Octoki client");
            const octokit = github.getOctokit(githubToken);
            core.info("Getting payload");
            const pull_request = github.context.payload;
            core.info("Send message");
            yield octokit.rest.issues.createComment(Object.assign(Object.assign({}, github.context.repo), { issue_number: pull_request.number, body: `${finalComment}` }));
        }
        if (jobResponseJson.data.attributes.status === "completed") {
            return true;
        }
        else {
            return false;
        }
    });
}
function setupVariable(terrakubeClient, organizationId, workspaceId, key, value) {
    return __awaiter(this, void 0, void 0, function* () {
        const variableId = yield terrakubeClient.getVariableId(organizationId, workspaceId, key);
        if (variableId === "") {
            yield terrakubeClient.createVariable(organizationId, workspaceId, key, value);
            return true;
        }
        else {
            const variableData = yield terrakubeClient.getVariableById(organizationId, workspaceId, variableId);
            if (variableData.data.attributes.value === value) {
                return false;
            }
            else {
                yield terrakubeClient.updateVariableById(organizationId, workspaceId, variableId, value);
                return true;
            }
        }
    });
}
run();
