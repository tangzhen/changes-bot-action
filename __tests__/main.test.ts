/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import { wait } from '../__fixtures__/wait.js'

// Mock GitHub and exec modules
const mockExec = {
  exec: jest.fn().mockImplementation(() => Promise.resolve(0))
}

const mockContext = {
  eventName: 'push',
  payload: {
    after: 'mock-commit-sha',
    push: true
  },
  repo: {
    owner: 'test-owner',
    repo: 'test-repo'
  }
}

const mockOctokit = {
  rest: {
    git: {
      getCommit: jest.fn().mockImplementation(() => ({
        data: { message: 'test commit' }
      }))
    },
    repos: {
      getCommit: jest.fn().mockImplementation(() => ({
        data: {
          files: [{ filename: 'data/test.json' }, { filename: 'src/main.ts' }]
        }
      }))
    },
    pulls: {
      listFiles: jest.fn().mockImplementation(() => ({
        data: [{ filename: 'data/test.json' }, { filename: 'src/main.ts' }]
      }))
    }
  }
}

const mockGithub = {
  getOctokit: jest.fn().mockImplementation(() => mockOctokit),
  context: mockContext
}

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => mockGithub)
jest.unstable_mockModule('@actions/exec', () => mockExec)
jest.unstable_mockModule('../src/wait.js', () => ({ wait }))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    // Set the action's inputs as return values from core.getInput().
    core.getInput.mockImplementation((name) => {
      if (name === 'milliseconds') return '500'
      if (name === 'file-patterns') return 'data/*.json,data/*.csv'
      if (name === 'command') return 'npm run update-reports'
      if (name === 'commit-patterns') return 'reports/*.md,reports/*.json'
      if (name === 'commit-message') return 'Auto-update reports'
      if (name === 'github-token') return 'mock-token'
      return ''
    })

    // Mock the wait function so that it does not actually wait.
    wait.mockImplementation(() => Promise.resolve('done!'))
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Sets outputs correctly when matching files are found', async () => {
    await run()

    // Verify the outputs were set correctly
    expect(core.setOutput).toHaveBeenCalledWith(
      'time',
      expect.stringMatching(/^\d{2}:\d{2}:\d{2}/)
    )
    expect(core.setOutput).toHaveBeenCalledWith('changes-detected', 'true')
  })

  it('Sets a failed status on error', async () => {
    // Clear the getInput mock and return an invalid value.
    core.getInput.mockClear().mockReturnValueOnce('this is not a number')

    // Clear the wait mock and return a rejected promise.
    wait
      .mockClear()
      .mockRejectedValueOnce(new Error('milliseconds is not a number'))

    await run()

    // Verify that the action was marked as failed.
    expect(core.setFailed).toHaveBeenNthCalledWith(
      1,
      'milliseconds is not a number'
    )
  })
})
