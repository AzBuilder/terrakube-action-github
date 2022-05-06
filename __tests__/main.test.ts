import {wait} from '../src/wait'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {expect, test} from '@jest/globals'

// shows how the runner will run a javascript action with env / stdout protocol
test('test runs', () => {
  process.env['INPUT_MILLISECONDS'] = '500'
  process.env['INPUT_LOGIN_ENDPOINT'] = 'https://login.microsoftonline.com'
  process.env['INPUT_TERRAKUBE_TENANT_ID'] = ''
  process.env['INPUT_TERRAKUBE_APPLICATION_ID'] = ''
  process.env['INPUT_TERRAKUBE_APPLICATION_SECRET'] = ''
  process.env['INPUT_TERRAKUBE_ENDPOINT'] = ''
  process.env['INPUT_TERRAKUBE_APPLICATION_SCOPE'] = ''
  process.env['INPUT_TERRAKUBE_ORGANIZATION'] = ''
  process.env['INPUT_TERRAKUBE_WORKSPACE'] = ''
  process.env['INPUT_TERRAKUBE_TEMPLATE'] = ''
  process.env['NODE_DEBUG'] = 'http'
  const np = process.execPath
  const ip = path.join(__dirname, '..', 'lib', 'main.js')
  const options: cp.ExecFileSyncOptions = {
    env: process.env
  }
  //console.log(cp.execFileSync(np, [ip], options).toString())
})