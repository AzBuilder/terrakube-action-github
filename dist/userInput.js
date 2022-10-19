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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActionInput = void 0;
const core = __importStar(require("@actions/core"));
function getActionInput() {
    return __awaiter(this, void 0, void 0, function* () {
        const terrakubeToken = core.getInput('terrakube_token', { required: true });
        core.debug(`Terrakube Token: ${terrakubeToken.substring(0, 10)}****`);
        const terrakubeEndpoint = core.getInput('terrakube_endpoint', { required: true });
        core.debug(`Terrakube Endpoint: ${terrakubeEndpoint}`);
        const terrakubeSshKeyName = core.getInput('INPUT_TERRAKUBE_SSH_KEY_NAME', { required: true });
        const server_url = core.getInput('INPUT_SERVER_URL', { required: true });
        const git_repository = core.getInput('INPUT_GIT_REPOSITORY', { required: true });
        let terrakubeRepository = "";
        if (terrakubeSshKeyName.length > 0) {
            terrakubeRepository = `git@${new URL(server_url).hostname}:${git_repository}.git`;
        }
        else {
            terrakubeRepository = `${server_url}/${git_repository}.git`;
        }
        core.debug(`Terrakube Repository: ${terrakubeRepository}`);
        const terrakubeTemplate = core.getInput('terrakube_template', { required: true });
        core.debug(`Terrakube Template: ${terrakubeTemplate}`);
        const terrakubeBranch = core.getInput('terrakube_branch', { required: true });
        core.debug(`Terrakube Branch: ${terrakubeBranch}`);
        const terrakubeFolder = core.getInput('terrakube_folder', { required: true });
        core.debug(`Terrakube Folder: ${terrakubeFolder}`);
        const terrakubeOrganization = core.getInput('terrakube_organization', { required: true });
        core.debug(`Terrakube Organization: ${terrakubeOrganization}`);
        const showOutput = core.getBooleanInput('show_output', { required: true });
        core.debug(`Show Output Job: ${terrakubeOrganization}`);
        const githubToken = core.getInput('github_token', { required: true });
        const terrakubeActionInput = {
            token: terrakubeToken,
            terrakubeEndpoint: terrakubeEndpoint,
            terrakubeRepository: terrakubeRepository,
            terrakubeTemplate: terrakubeTemplate,
            terrakubeOrganization: terrakubeOrganization,
            terrakubeFolder: terrakubeFolder,
            terrakubeSshKeyName: terrakubeSshKeyName,
            githubToken: githubToken,
            showOutput: showOutput,
            branch: terrakubeBranch
        };
        return terrakubeActionInput;
    });
}
exports.getActionInput = getActionInput;
