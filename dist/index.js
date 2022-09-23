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
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const glob = __importStar(require("@actions/glob"));
const exec = __importStar(require("@actions/exec"));
const httpm = __importStar(require("@actions/http-client"));
const github = __importStar(require("@actions/github"));
const userInput_1 = require("./userInput");
const terrakube_1 = require("./terrakube");
const promises_1 = require("fs/promises");
function run() {
    var e_1, _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const githubActionInput = yield (0, userInput_1.getActionInput)();
            const terrakubeClient = new terrakube_1.TerrakubeClient(githubActionInput);
            const patterns = ['**/terrakube.json'];
            const globber = yield glob.create(patterns.join('\n'));
            const currentDirectory = yield getCurrentDirectory();
            console.debug(`Processing: ${currentDirectory}`);
            try {
                for (var _b = __asyncValues(globber.globGenerator()), _c; _c = yield _b.next(), !_c.done;) {
                    const file = _c.value;
                    const terrakubeData = JSON.parse(yield (0, promises_1.readFile)(`${file}`, "utf8"));
                    core.startGroup(`Execute Workspace ${terrakubeData.workspace}`);
                    console.debug(`Processing: ${file}`);
                    //terrakubeData.respository = await getRepository()
                    //terrakubeData.folder = file.replace(currentDirectory,'')
                    core.debug(`Loaded JSON: ${JSON.stringify(terrakubeData)}`);
                    core.info(`Organization: ${terrakubeData.organization}`);
                    core.info(`Workspace: ${terrakubeData.workspace}`);
                    core.info(`Folder: ${terrakubeData.folder}`);
                    core.info(`Branch: ${process.env.GITHUB_REF_NAME}`);
                    terrakubeData.branch = process.env.GITHUB_REF_NAME;
                    //Object.keys(terrakubeData.variables).forEach(key => {
                    //  console.log('Key : ' + key + ', Value : ' + terrakubeData.variables[key])
                    //})
                    core.info(`Running Workspace ${terrakubeData.workspace} with Template ${githubActionInput.terrakubeTemplate}`);
                    core.info(`Checking if workspace ${terrakubeData.workspace}`);
                    const organizationId = yield terrakubeClient.getOrganizationId(terrakubeData.organization);
                    if (organizationId !== "") {
                        //let updateJob = false
                        let workspaceId = yield terrakubeClient.getWorkspaceId(organizationId, terrakubeData.workspace);
                        if (workspaceId === "") {
                            core.info(`Creating new workspace ${terrakubeData.workspace}`);
                            workspaceId = yield terrakubeClient.createWorkspace(organizationId, terrakubeData.workspace, terrakubeData.terraform, terrakubeData.folder, terrakubeData.workspaceSrc, terrakubeData.branch);
                            //updateJob = true
                        }
                        core.info(`Searching template ${githubActionInput.terrakubeTemplate}`);
                        const templateId = yield terrakubeClient.getTemplateId(organizationId, githubActionInput.terrakubeTemplate);
                        if (templateId !== "") {
                            core.info(`Using template id ${templateId}`);
                            /*
                            for await (const key of Object.keys(terrakubeData.variables)) {
                              const updateVar = await setupVariable(
                                terrakubeClient,
                                organizationId,
                                workspaceId,
                                key,
                                terrakubeData.variables[key]
                              )
                  
                              if (updateVar && !updateJob) {
                                updateJob = true;
                              }
                            }*/
                            //core.info(`Update Job: ${updateJob}`)
                            //if (updateJob) {
                            core.info(`Creating new job: `);
                            const jobId = yield terrakubeClient.createJobId(organizationId, workspaceId, templateId);
                            core.debug(`JobId: ${jobId}`);
                            yield checkTerrakubeLogs(terrakubeClient, githubActionInput.githubToken, organizationId, jobId);
                            //core.setOutput(`Organization: ${terrakubeData.organization} Workspace: ${terrakubeData.workspace} Job`, jobId);
                            //}
                        }
                        else {
                            core.error(`Template not found: ${githubActionInput.terrakubeTemplate} in Organization: ${terrakubeData.organization}`);
                        }
                    }
                    else {
                        core.error(`Organization not found: ${terrakubeData.organization} in Endpoint: ${githubActionInput.terrakubeEndpoint}`);
                    }
                    core.endGroup();
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
function checkTerrakubeLogs(terrakubeClient, githubToken, organizationId, jobId) {
    return __awaiter(this, void 0, void 0, function* () {
        let jobRunning = true;
        let jobResponse = yield terrakubeClient.getJobData(organizationId, jobId);
        let jobResponseJson = JSON.parse(jobResponse);
        while (jobResponseJson.data.attributes.status !== "completed" && jobResponseJson.data.attributes.status !== "failed") {
            yield sleep(5000);
            jobResponse = yield terrakubeClient.getJobData(organizationId, jobId);
            jobResponseJson = JSON.parse(jobResponse);
            core.debug("Waiting for job information...");
        }
        core.info(`${jobResponse}`);
        core.info(`${JSON.stringify(jobResponseJson.included)}`);
        const httpClient = new httpm.HttpClient();
        const jobSteps = jobResponseJson.included;
        core.info(`${Object.keys(jobSteps).length}`);
        let finalComment = "";
        for (let index = 0; index < Object.keys(jobSteps).length; index++) {
            core.startGroup(`Running ${jobSteps[index].attributes.name}`);
            const response = yield httpClient.get(`${jobSteps[index].attributes.output}`);
            const body = yield response.readBody();
            core.info(body);
            core.endGroup();
            const commentBody = `Running ${jobSteps[index].attributes.name} \n \`\`\`\n${body}\`\`\` `;
            finalComment = finalComment.concat(commentBody);
        }
        core.info("Setup client");
        const octokit = github.getOctokit(githubToken);
        core.info("Getting payload");
        const pull_request = github.context.payload;
        core.info("Send message");
        yield octokit.rest.issues.createComment(Object.assign(Object.assign({}, github.context.repo), { issue_number: pull_request.number, body: `${finalComment}` }));
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
function getRepository() {
    return __awaiter(this, void 0, void 0, function* () {
        let repository = '';
        let errorGitCommand = '';
        let options = {};
        options.listeners = {
            stdout: (data) => {
                repository += data.toString();
            },
            stderr: (data) => {
                errorGitCommand += data.toString();
            }
        };
        yield exec.exec('git', ['config', '--get', 'remote.origin.url'], options);
        return repository;
    });
}
function getCurrentDirectory() {
    return __awaiter(this, void 0, void 0, function* () {
        let repository = '';
        let errorGitCommand = '';
        let options = {};
        options.listeners = {
            stdout: (data) => {
                repository += data.toString();
            },
            stderr: (data) => {
                errorGitCommand += data.toString();
            }
        };
        yield exec.exec('pwd', [], options);
        return repository;
    });
}
run();
