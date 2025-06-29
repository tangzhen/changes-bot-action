import * as core from '@actions/core'
import * as github from '@actions/github'
import * as exec from '@actions/exec'
import { wait } from './wait.js'

/**
 * Checks if a file matches any of the given patterns
 * @param file File path to check
 * @param patterns Array of glob patterns
 * @returns boolean indicating if the file matches any pattern
 */
function fileMatchesPatterns(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')

    return new RegExp(`^${regexPattern}$`).test(file)
  })
}

/**
 * Gets the list of changed files in the current commit
 * @returns Array of changed file paths
 */
async function getChangedFiles(): Promise<string[]> {
  const token = core.getInput('github-token')
  const octokit = github.getOctokit(token)
  const context = github.context

  // Only run on push events or PRs
  if (!context.payload.push && !context.payload.pull_request) {
    core.info(
      'Not a push or pull request event, skipping file change detection'
    )
    return []
  }

  let changedFiles: string[] = []

  if (context.eventName === 'push') {
    // Get commit SHA
    const { owner, repo } = context.repo
    const commitSha = context.payload.after

    // Get the commit details including file changes
    try {
      const { data: commitDetails } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: commitSha
      })

      changedFiles = commitDetails.files?.map((file) => file.filename) || []
    } catch (error) {
      core.warning(
        `Error getting commit details: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  } else if (context.eventName === 'pull_request') {
    // Get PR number
    const prNumber = context.payload.pull_request?.number
    if (prNumber) {
      const { owner, repo } = context.repo

      try {
        // Get files changed in PR
        const { data: files } = await octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber
        })

        changedFiles = files.map((file) => file.filename)
      } catch (error) {
        core.warning(
          `Error getting PR files: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  core.debug(`Changed files: ${JSON.stringify(changedFiles)}`)
  return changedFiles
}

/**
 * Commits and pushes changes for files matching the given patterns
 * @param patterns Array of glob patterns
 * @param commitMessage Commit message to use
 * @returns Array of committed files
 */
async function commitAndPushChanges(
  patterns: string[],
  commitMessage: string
): Promise<string[]> {
  // Get modified files
  let output = ''

  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      },
      stderr: () => {
        // We don't need to use stderr for this function
      }
    }
  }

  await exec.exec('git', ['status', '--porcelain'], options)

  const modifiedFiles = output
    .split('\n')
    .filter(Boolean)
    .map((line) => line.substring(3)) // Remove status prefix (like " M ")
    .filter((file) => fileMatchesPatterns(file, patterns))

  if (modifiedFiles.length === 0) {
    core.info('No matching files were modified, skipping commit')
    return []
  }

  // Set git identity (using GitHub Actions bot)
  await exec.exec('git', ['config', 'user.name', 'github-actions[bot]'])
  await exec.exec('git', [
    'config',
    'user.email',
    '41898282+github-actions[bot]@users.noreply.github.com'
  ])

  // Stage files
  for (const file of modifiedFiles) {
    await exec.exec('git', ['add', file])
    core.info(`Staged file: ${file}`)
  }

  // Commit changes
  await exec.exec('git', ['commit', '-m', commitMessage])
  core.info(`Committed ${modifiedFiles.length} files`)

  // Push changes
  await exec.exec('git', ['push'])
  core.info('Pushed changes to remote repository')

  return modifiedFiles
}

/**
 * The main function for the action.
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Get inputs
    const filePatterns = core
      .getInput('file-patterns')
      .split(',')
      .map((p) => p.trim())
    const command = core.getInput('command')
    const commitPatterns = core
      .getInput('commit-patterns')
      .split(',')
      .map((p) => p.trim())
    const commitMessage = core.getInput('commit-message')
    const ms = core.getInput('milliseconds')

    // Debug logs
    core.debug(`File patterns: ${JSON.stringify(filePatterns)}`)
    core.debug(`Command: ${command}`)
    core.debug(`Commit patterns: ${JSON.stringify(commitPatterns)}`)
    core.debug(`Commit message: ${commitMessage}`)

    // Wait if specified (for debugging)
    if (parseInt(ms, 10) > 0) {
      core.debug(`Waiting ${ms} milliseconds...`)
      core.debug(new Date().toTimeString())
      await wait(parseInt(ms, 10))
      core.debug(new Date().toTimeString())
    }

    // Get changed files
    const changedFiles = await getChangedFiles()

    // Check if any changed files match the patterns
    const matchingChanges = changedFiles.filter((file) =>
      fileMatchesPatterns(file, filePatterns)
    )

    let changesDetected = false
    let committedFiles: string[] = []

    if (matchingChanges.length > 0) {
      changesDetected = true
      core.info(
        `Found ${matchingChanges.length} changed files matching patterns`
      )
      core.info(`Changed files: ${JSON.stringify(matchingChanges)}`)

      // Run the command
      core.info(`Running command: ${command}`)
      await exec.exec(command)

      // Check if any files matching commit patterns were modified
      committedFiles = await commitAndPushChanges(commitPatterns, commitMessage)
    } else {
      core.info('No matching files were changed, skipping command execution')
    }

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
    core.setOutput('changes-detected', changesDetected.toString())
    core.setOutput('files-committed', JSON.stringify(committedFiles))
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
