import {wait} from '../src/wait'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {expect, test} from '@jest/globals'

// shows how the runner will run a javascript action with env / stdout protocol
test('test runs', () => {
  process.env['INPUT_MILLISECONDS'] = '500'
  process.env['INPUT_TERRAKUBE_TOKEN'] = ''
  process.env['INPUT_TERRAKUBE_ENDPOINT'] = ''
  process.env['INPUT_TERRAKUBE_REPOSITORY'] = ''
  process.env['INPUT_TERRAKUBE_TEMPLATE'] = 'Terraform-Plan'
  process.env['NODE_DEBUG'] = 'http'
  const np = process.execPath
  const ip = path.join(__dirname, '..', 'lib', 'main.js')
  const options: cp.ExecFileSyncOptions = {
    env: process.env
  }
  //cp.execFileSync(np, [ip], options)
  //console.log(cp.execFileSync(np, [ip], options).toString())
})