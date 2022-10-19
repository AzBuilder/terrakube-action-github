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
exports.TerrakubeClient = void 0;
const core = __importStar(require("@actions/core"));
const httpm = __importStar(require("@actions/http-client"));
class TerrakubeClient {
    constructor(gitHubActionInput) {
        this.httpClient = new httpm.HttpClient();
        this.gitHubActionInput = gitHubActionInput;
        this.authenticationToken = 'empty';
        core.info(`Creating Terrakube CLient....`);
        core.info(`Endpoint: ${gitHubActionInput.terrakubeEndpoint}`);
        core.info(`Repository: ${gitHubActionInput.terrakubeRepository}`);
        core.info(`Template: ${gitHubActionInput.terrakubeTemplate}`);
    }
    getOrganizationId(organizationName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization?filter[organization]=name==${organizationName}`);
            const response = yield this.httpClient.get(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization?filter[organization]=name==${organizationName}`, {
                'Authorization': `Bearer ${this.authenticationToken}`
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response size: ${terrakubeResponse.data.length}`);
            if (terrakubeResponse.data.length === 0) {
                return "";
            }
            else {
                core.debug(`Organization Id: ${terrakubeResponse.data[0].id}`);
                return terrakubeResponse.data[0].id;
            }
        });
    }
    getWorkspaceId(organizationId, workspaceName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace?filter[workspace]=name==${workspaceName}"`);
            const response = yield this.httpClient.get(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace?filter[workspace]=name==${workspaceName}`, {
                'Authorization': `Bearer ${this.authenticationToken}`
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response size: ${terrakubeResponse.data.length}`);
            if (terrakubeResponse.data.length === 0) {
                return "";
            }
            else {
                core.info(`Workspace Id: ${terrakubeResponse.data[0].id}`);
                return terrakubeResponse.data[0].id;
            }
        });
    }
    createWorkspace(organizationId, name, terraformVersion, folder, repository, branch, ssh_key_id) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`POST ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace`);
            const sshData = `,
        "relationships": {
            "ssh": {
                "data": {
                    "type": "ssh",
                    "id": "${ssh_key_id}"
                }
            }
        }`;
            const response = yield this.httpClient.post(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace`, `{
                "data": {
                  "type": "workspace",
                  "attributes": {
                    "name": "${name}",
                    "source": "${repository}",
                    "branch": "${branch}",
                    "folder": "${folder}",
                    "terraformVersion": "${terraformVersion}"
                  }${(ssh_key_id.length > 0 ? sshData : "")}
                }
              }`, {
                'Authorization': `Bearer ${this.authenticationToken}`,
                'Content-Type': 'application/vnd.api+json'
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response: ${JSON.stringify(terrakubeResponse)}`);
            core.info(`Variable Id: ${terrakubeResponse.data.id}`);
            return terrakubeResponse.data.id;
        });
    }
    getTemplateId(organizationId, templateName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/template?filter[template]=name==${templateName}`);
            const response = yield this.httpClient.get(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/template?filter[template]=name==${templateName}`, {
                'Authorization': `Bearer ${this.authenticationToken}`
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response size: ${terrakubeResponse.data.length}`);
            if (terrakubeResponse.data.length === 0) {
                return "";
            }
            else {
                core.info(`Template Id: ${terrakubeResponse.data[0].id}`);
                return terrakubeResponse.data[0].id;
            }
        });
    }
    getSshId(organizationId, sshName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/ssh?filter[ssh]=name==${sshName}`);
            const response = yield this.httpClient.get(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/ssh?filter[ssh]=name==${sshName}`, {
                'Authorization': `Bearer ${this.authenticationToken}`
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response size: ${terrakubeResponse.data.length}`);
            if (terrakubeResponse.data.length === 0) {
                return "";
            }
            else {
                core.info(`Ssh Id: ${terrakubeResponse.data[0].id}`);
                return terrakubeResponse.data[0].id;
            }
        });
    }
    getVariableId(organizationId, workspaceId, variableName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable?filter[variable]=key==${variableName}`);
            const response = yield this.httpClient.get(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable?filter[variable]=key==${variableName}`, {
                'Authorization': `Bearer ${this.authenticationToken}`
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response size: ${terrakubeResponse.data.length === 0}`);
            if (terrakubeResponse.data.length === 0) {
                return "";
            }
            else {
                core.info(`Variable Id: ${terrakubeResponse.data[0].id}`);
                return terrakubeResponse.data[0].id;
            }
        });
    }
    getVariableById(organizationId, workspaceId, variableId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable/${variableId}`);
            const response = yield this.httpClient.get(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable/${variableId}`, {
                'Authorization': `Bearer ${this.authenticationToken}`
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response: ${terrakubeResponse}`);
            return terrakubeResponse;
        });
    }
    updateVariableById(organizationId, workspaceId, variableId, variableValue) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`PATCH ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable/${variableId}`);
            const response = yield this.httpClient.patch(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable/${variableId}`, `{
                "data": {
                  "type": "variable",
                  "id": "${variableId}",
                  "attributes": {
                    "value": "${variableValue}"
                  }
                }
              }`, {
                'Authorization': `Bearer ${this.authenticationToken}`,
                'Content-Type': 'application/vnd.api+json'
            });
            const body = yield response.readBody();
            core.debug(`Updated Variable: ${variableId}`);
            return true;
        });
    }
    createVariable(organizationId, workspaceId, variableName, varaibleValue) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`POST ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable`);
            const response = yield this.httpClient.post(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable`, `{
                "data": {
                  "type": "variable",
                  "attributes": {
                    "key": "${variableName}",
                    "value": "${varaibleValue}",
                    "sensitive": false,
                    "hcl": false,
                    "category": "TERRAFORM",
                    "description": ""
                  }
                }
              }`, {
                'Authorization': `Bearer ${this.authenticationToken}`,
                'Content-Type': 'application/vnd.api+json'
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response: ${JSON.stringify(terrakubeResponse)}`);
            core.info(`Variable Id: ${terrakubeResponse.data.id}`);
            return terrakubeResponse.data.id;
        });
    }
    getVariableValue(organizationId, workspaceId, variableName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable?filter[variable]=key==${variableName}`);
            const response = yield this.httpClient.get(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace/${workspaceId}/variable?filter[variable]=key==${variableName}`, {
                'Authorization': `Bearer ${this.authenticationToken}`
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(`Response size: ${terrakubeResponse.data.length}`);
            if (terrakubeResponse.data.length === 0) {
                return "";
            }
            else {
                core.info(`Variable Id: ${terrakubeResponse.data[0].id}`);
                return terrakubeResponse.data[0].attributes.value;
            }
        });
    }
    createJobId(organizationId, workspaceId, templateId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            const requestBody = {
                "data": {
                    "type": "job",
                    "attributes": {
                        "templateReference": templateId
                    },
                    "relationships": {
                        "workspace": {
                            "data": {
                                "type": "workspace",
                                "id": workspaceId
                            }
                        }
                    }
                }
            };
            core.debug(`POST ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/job`);
            core.debug(`${JSON.stringify(requestBody)}`);
            const response = yield this.httpClient.post(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/job`, JSON.stringify(requestBody), {
                'Authorization': `Bearer ${this.authenticationToken}`,
                'Content-Type': 'application/vnd.api+json'
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(JSON.stringify(terrakubeResponse));
            return terrakubeResponse.data.id;
        });
    }
    getJobData(organizationId, jobId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.authenticationToken === 'empty') {
                this.authenticationToken = this.gitHubActionInput.token;
            }
            core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/job/${jobId}?include=step`);
            const response = yield this.httpClient.get(`${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/job/${jobId}?include=step`, {
                'Authorization': `Bearer ${this.authenticationToken}`
            });
            const body = yield response.readBody();
            const terrakubeResponse = JSON.parse(body);
            core.debug(JSON.stringify(terrakubeResponse));
            return body;
        });
    }
}
exports.TerrakubeClient = TerrakubeClient;
