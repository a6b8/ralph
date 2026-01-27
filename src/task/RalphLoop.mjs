import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'

import { Print } from '../utils/Print.mjs'
import { UserConfig } from '../utils/UserConfig.mjs'
import { ClaudeTool } from '../tools/index.mjs'


const EXIT_CODES = {
    SUCCESS: 0,
    INIT_FAILED: 1,
    SCHEMA_INVALID: 2,
    TASK_FAILED: 3,
    TASK_BLOCKED: 4,
    NETWORK_ERROR: 5,
    CLAUDE_ERROR: 6,
    FILE_NOT_FOUND: 7,
    INVALID_ARGS: 8,
    UNKNOWN: 99
}


class RalphLoop {
    // === USAGE TRACKING ===

    static #usageStats = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalCost: 0,
        taskCount: 0,
        contextWindow: 200000
    }


    static #resetUsageStats() {
        this.#usageStats = {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheRead: 0,
            totalCacheCreation: 0,
            totalCost: 0,
            taskCount: 0,
            contextWindow: 200000
        }
    }


    // === TASK LIST ID GENERATION ===

    static #generateTaskListId( { prdId, taskId, phase } ) {
        const now = new Date()
        const timestamp = [
            now.getFullYear(),
            String( now.getMonth() + 1 ).padStart( 2, '0' ),
            String( now.getDate() ).padStart( 2, '0' ),
            '-',
            String( now.getHours() ).padStart( 2, '0' ),
            String( now.getMinutes() ).padStart( 2, '0' )
        ].join( '' )

        const taskListId = phase === 'conversion'
            ? `${prdId}-convert-${timestamp}`
            : `${prdId}-${taskId}-${timestamp}`

        return { taskListId }
    }


    // === TEMPLATE HANDLING ===

    static async loadTemplate( { templateName, configPath = null, templateSet = 'default' } ) {
        const { exists } = await UserConfig.templateExists( {
            configPath,
            setName: templateSet,
            templateName
        } )

        if( !exists ) {
            const { templatePath } = UserConfig.getTemplatePath( {
                configPath,
                setName: templateSet,
                templateName
            } )
            throw new Error( `Template not found: ${templatePath}` )
        }

        const { templatePath } = UserConfig.getTemplatePath( {
            configPath,
            setName: templateSet,
            templateName
        } )
        const template = await fs.readFile( templatePath, 'utf-8' )

        // System prompt is now passed via --append-system-prompt-file flag
        // No longer appending to user prompt

        return { template }
    }


    static async loadSystemPromptPath( { configPath = null, templateSet = 'default' } ) {
        const { setConfig } = await UserConfig.loadSetConfig( { configPath, setName: templateSet } )
        const systemPromptFile = setConfig.systemPrompt || null

        if( !systemPromptFile ) {
            return { systemPromptPath: null }
        }

        const { systemPromptPath } = UserConfig.getSystemPromptPath( {
            configPath,
            setName: templateSet,
            systemPromptFile
        } )

        // Verify file exists
        const { exists } = await UserConfig.systemPromptExists( {
            configPath,
            setName: templateSet,
            systemPromptFile
        } )

        if( !exists ) {
            throw new Error( `System prompt not found: ${systemPromptPath}` )
        }

        return { systemPromptPath }
    }


    static buildPrompt( { template, replacements } ) {
        let prompt = template

        Object
            .entries( replacements )
            .forEach( ( [ key, value ] ) => {
                const placeholder = `{{${key}}}`
                prompt = prompt.replaceAll( placeholder, value )
            } )

        return { prompt }
    }


    // === PATH UTILITIES ===

    static extractProjectName( { prdPath } ) {
        const basename = path.basename( prdPath )
        // Take everything before the first dot
        const projectName = basename.split( '.' )[ 0 ]

        return { projectName }
    }


    static getRalphDir( { prdPath } ) {
        const dir = path.dirname( prdPath )
        const { projectName } = this.extractProjectName( { prdPath } )
        // Work directory = filename without .ralph extension
        const ralphDir = path.join( dir, projectName )

        return { ralphDir }
    }


    // === REPOSITORY DISCOVERY ===

    static async discoverGitRepos( { workingDir } ) {
        const repos = []

        try {
            const entries = await fs.readdir( workingDir, { withFileTypes: true } )

            const checkPromises = entries
                .filter( ( entry ) => entry.isDirectory() && !entry.name.startsWith( '.' ) )
                .map( async ( entry ) => {
                    const repoPath = path.join( workingDir, entry.name )
                    const gitPath = path.join( repoPath, '.git' )

                    try {
                        await fs.access( gitPath )

                        return {
                            path: `./${entry.name}`,
                            name: entry.name,
                            description: `Git repository: ${entry.name}`
                        }
                    } catch {
                        return null
                    }
                } )

            const results = await Promise.all( checkPromises )
            results
                .filter( ( r ) => r !== null )
                .forEach( ( repo ) => repos.push( repo ) )
        } catch {
            // Directory read failed
        }

        return { repos }
    }


    // === STATE MANAGEMENT ===

    static async checkExistingProject( { prdPath } ) {
        const { ralphDir } = this.getRalphDir( { prdPath } )
        const prdJsonPath = path.join( ralphDir, 'prd.json' )
        const progressPath = path.join( ralphDir, 'progress.json' )

        let exists = false
        let prd = null
        let progress = null

        try {
            await fs.access( ralphDir )
            exists = true

            const prdContent = await fs.readFile( prdJsonPath, 'utf-8' )
            prd = JSON.parse( prdContent )

            const progressContent = await fs.readFile( progressPath, 'utf-8' )
            progress = JSON.parse( progressContent )
        } catch {
            // Directory or files don't exist
        }

        return { exists, ralphDir, prd, progress }
    }


    static async saveState( { ralphDir, prd, progress } ) {
        await fs.mkdir( ralphDir, { recursive: true } )

        const prdPath = path.join( ralphDir, 'prd.json' )
        const progressPath = path.join( ralphDir, 'progress.json' )

        await fs.writeFile( prdPath, JSON.stringify( prd, null, 4 ), 'utf-8' )
        await fs.writeFile( progressPath, JSON.stringify( progress, null, 4 ), 'utf-8' )

        return { success: true }
    }


    static async saveError( { ralphDir, taskId, error } ) {
        const errorPath = path.join( ralphDir, 'error.log' )
        const errorEntry = {
            timestamp: new Date().toISOString(),
            taskId,
            message: error.message,
            stack: error.stack
        }

        let existingErrors = []
        try {
            const content = await fs.readFile( errorPath, 'utf-8' )
            existingErrors = JSON.parse( content )
        } catch {
            // File doesn't exist
        }

        existingErrors.push( errorEntry )
        await fs.writeFile( errorPath, JSON.stringify( existingErrors, null, 4 ), 'utf-8' )

        return { success: true }
    }


    static async saveTaskLog( { ralphDir, taskId, phase, output, usage, error = null, contextManagement = null } ) {
        const logPath = path.join( ralphDir, 'task.log' )
        const logEntry = {
            timestamp: new Date().toISOString(),
            taskId,
            phase,
            usage: usage || null,
            error: error || null,
            contextManagement: contextManagement || null,
            outputLength: output?.length || 0,
            outputPreview: output?.substring( 0, 500 ) || null,
            fullOutput: output || null
        }

        let existingLogs = []
        try {
            const content = await fs.readFile( logPath, 'utf-8' )
            existingLogs = JSON.parse( content )
        } catch {
            // File doesn't exist
        }

        existingLogs.push( logEntry )
        await fs.writeFile( logPath, JSON.stringify( existingLogs, null, 4 ), 'utf-8' )

        return { success: true }
    }


    // === CLAUDE EXECUTION ===

    static async callClaude( { prompt, workingDir, showProgress = false, progressLabel = null, tableMode = null, toolConfig = {}, prdId = null, taskId = null, phase = 'task', systemPromptFile = null } ) {
        return new Promise( ( resolve ) => {
            // Use ClaudeTool to build CLI arguments
            const { args } = ClaudeTool.buildArgs( { config: toolConfig, tableMode, systemPromptFile } )

            // Add prompt as last argument
            args.push( prompt )

            // Build spawn options with optional task list ID
            const spawnOptions = {
                cwd: workingDir,
                stdio: [ 'ignore', 'pipe', 'pipe' ]
            }

            // Add CLAUDE_CODE_TASK_LIST_ID if prdId is provided
            if( prdId ) {
                const { taskListId } = this.#generateTaskListId( { prdId, taskId, phase } )
                spawnOptions.env = {
                    ...process.env,
                    CLAUDE_CODE_TASK_LIST_ID: taskListId
                }
            }

            const child = spawn( 'claude', args, spawnOptions )

            let stdout = ''
            let stderr = ''
            let streamBuffer = ''
            let taskUsage = null
            let contextManagement = null
            let structuredOutput = null
            let spinnerIndex = 0
            const spinnerFrames = [ '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏' ]
            let spinnerInterval = null
            let currentStatus = 'Initializing...'
            let currentTokens = 0
            let currentContextWindow = 200000

            // Start spinner if showing progress (legacy mode)
            if( showProgress && !tableMode ) {
                Print.startSpinner( { label: progressLabel, message: 'Initializing...' } )
            }

            // Start table-based spinner for tableMode
            if( tableMode ) {
                spinnerInterval = setInterval( () => {
                    spinnerIndex = ( spinnerIndex + 1 ) % spinnerFrames.length
                    const percentage = currentContextWindow > 0 ? Math.round( ( currentTokens / currentContextWindow ) * 100 ) : 0

                    if( tableMode === 'conversion' ) {
                        Print.tableConversionUpdate( {
                            percentage,
                            tokens: currentTokens,
                            contextWindow: currentContextWindow,
                            status: currentStatus,
                            spinnerFrame: spinnerFrames[ spinnerIndex ]
                        } )
                    } else if( tableMode === 'task' ) {
                        Print.tableTaskUpdate( {
                            percentage,
                            tokens: currentTokens,
                            contextWindow: currentContextWindow,
                            status: currentStatus,
                            spinnerFrame: spinnerFrames[ spinnerIndex ]
                        } )
                    }
                }, 80 )
            }

            child.stdout.on( 'data', ( data ) => {
                const chunk = data.toString()
                stdout += chunk

                // Parse stream events for progress display
                if( showProgress || tableMode ) {
                    const { events, buffer } = Print.parseStreamChunk( { chunk, buffer: streamBuffer } )
                    streamBuffer = buffer

                    events
                        .forEach( ( event ) => {
                            const { status } = Print.getStatusFromEvent( { event } )
                            if( status ) {
                                if( tableMode ) {
                                    currentStatus = status
                                } else {
                                    Print.updateSpinner( { message: status } )
                                }
                            }

                            // Live token update from assistant events
                            if( event.type === 'assistant' && event.message?.usage ) {
                                const liveUsage = event.message.usage
                                const liveTokens = ( liveUsage.input_tokens || 0 ) + ( liveUsage.cache_creation_input_tokens || 0 )

                                if( tableMode ) {
                                    currentTokens = liveTokens
                                } else {
                                    Print.updateTokens( { tokens: liveTokens, contextWindow: 200000 } )
                                }
                            }

                            // Extract final token usage and structured_output from result event
                            if( event.type === 'result' ) {
                                // Extract structured_output if present
                                if( event.structured_output ) {
                                    structuredOutput = event.structured_output
                                }

                                if( event.usage ) {
                                    const usage = event.usage
                                    const modelUsage = event.modelUsage || {}
                                    const model = Object.keys( modelUsage )[ 0 ]

                                    taskUsage = {
                                        inputTokens: usage.input_tokens || 0,
                                        outputTokens: usage.output_tokens || 0,
                                        cacheRead: usage.cache_read_input_tokens || 0,
                                        cacheCreation: usage.cache_creation_input_tokens || 0,
                                        costUsd: event.total_cost_usd || 0,
                                        contextWindow: modelUsage[ model ]?.contextWindow || 200000
                                    }

                                    // Final token update
                                    const finalTokens = taskUsage.inputTokens + taskUsage.cacheCreation

                                    if( tableMode ) {
                                        currentTokens = finalTokens
                                        currentContextWindow = taskUsage.contextWindow
                                    } else {
                                        Print.updateTokens( { tokens: finalTokens, contextWindow: taskUsage.contextWindow } )
                                    }
                                }
                            }

                            // Extract context management info from assistant events
                            if( event.type === 'assistant' && event.message?.context_management ) {
                                contextManagement = event.message.context_management
                            }
                        } )
                }
            } )

            child.stderr.on( 'data', ( data ) => {
                stderr += data.toString()
            } )

            child.on( 'close', ( code ) => {
                // Stop table spinner interval
                if( spinnerInterval ) {
                    clearInterval( spinnerInterval )
                }

                if( showProgress && !tableMode ) {
                    Print.stopSpinner( { success: code === 0, message: code === 0 ? 'Done' : 'Failed' } )
                }

                if( code === 0 ) {
                    resolve( { output: stdout, error: null, usage: taskUsage, contextManagement, structuredOutput } )
                } else {
                    // Even on error, return structuredOutput if we got it (Claude bug workaround)
                    const error = new Error( `Claude exited with code ${code}: ${stderr}` )
                    resolve( { output: stdout, error, usage: taskUsage, contextManagement, structuredOutput } )
                }
            } )

            child.on( 'error', ( err ) => {
                // Stop table spinner interval
                if( spinnerInterval ) {
                    clearInterval( spinnerInterval )
                }

                if( showProgress && !tableMode ) {
                    Print.stopSpinner( { success: false, message: 'Error' } )
                }
                resolve( { output: null, error: err, usage: null, contextManagement: null, structuredOutput: null } )
            } )
        } )
    }


    static extractJson( { text } ) {
        let contentText = text

        // Check if this is stream-json format (JSONL with multiple lines)
        const lines = text.trim().split( '\n' )
        const isStreamJson = lines.length > 1 && lines[ 0 ].startsWith( '{"type":' )

        if( isStreamJson ) {
            // Find ALL assistant messages with text content, take the LAST one
            const assistantTexts = []

            lines
                .forEach( ( line ) => {
                    try {
                        const parsed = JSON.parse( line )

                        if( parsed.type === 'assistant' ) {
                            const content = parsed?.message?.content || []
                            const textContent = content
                                .find( ( c ) => c.type === 'text' )

                            if( textContent?.text ) {
                                assistantTexts.push( textContent.text )
                            }
                        }
                    } catch {
                        // Skip invalid JSON lines
                    }
                } )

            // Use the last assistant text (final response)
            if( assistantTexts.length > 0 ) {
                contentText = assistantTexts[ assistantTexts.length - 1 ]
            }
        }

        // Try to find JSON in the text (might be wrapped in markdown code blocks)
        let jsonStr = contentText

        // Remove markdown code blocks if present
        const jsonMatch = contentText.match( /```(?:json)?\s*([\s\S]*?)```/ )
        if( jsonMatch ) {
            jsonStr = jsonMatch[ 1 ]
        }

        // Try to find raw JSON object
        const objectMatch = jsonStr.match( /(\{[\s\S]*\})/ )
        if( objectMatch ) {
            jsonStr = objectMatch[ 1 ]
        }

        try {
            const parsed = JSON.parse( jsonStr.trim() )

            return { json: parsed, error: null }
        } catch ( err ) {
            return { json: null, error: err }
        }
    }


    // === LOOP LOGIC ===

    static findNextTask( { userStories, completedIds } ) {
        const completedSet = new Set( completedIds )

        const nextTask = userStories
            .find( ( story ) => {
                // Skip already completed
                if( completedSet.has( story.id ) ) {
                    return false
                }

                // Skip if status is completed/failed
                if( story.status === 'completed' || story.status === 'failed' ) {
                    return false
                }

                // Check if all dependencies are satisfied
                const allDependenciesMet = story.dependencies
                    .every( ( depId ) => completedSet.has( depId ) )

                return allDependenciesMet
            } ) || null

        return { nextTask }
    }


    static formatCompletedTasks( { userStories, completedIds } ) {
        if( completedIds.length === 0 ) {
            return { formatted: 'None - this is the first task.' }
        }

        const lines = completedIds
            .map( ( id ) => {
                const story = userStories.find( ( s ) => s.id === id )
                if( !story ) {
                    return `- ${id}: (not found)`
                }

                // Format commits array
                const commits = story.commits || []
                const commitInfo = commits.length > 0
                    ? commits.map( ( c ) => `${c.repo}(${c.repoPath}):${c.commitHash?.substring( 0, 7 ) || 'none'}` ).join( ', ' )
                    : 'none'

                return `- ${id}: ${story.title} (commits: ${commitInfo})`
            } )

        return { formatted: lines.join( '\n' ) }
    }


    static formatTargetDirs( { targetDirs } ) {
        if( !targetDirs || targetDirs.length === 0 ) {
            return { formatted: 'None discovered.' }
        }

        const lines = targetDirs
            .map( ( dir ) => `- ${dir.name}: ${dir.path} (${dir.description || 'no description'})` )

        return { formatted: lines.join( '\n' ) }
    }


    static formatAffectedRepos( { affectedRepos, targetDirs } ) {
        if( !affectedRepos || affectedRepos.length === 0 ) {
            return { formatted: 'All available repositories may be affected.' }
        }

        const lines = affectedRepos
            .map( ( repoName ) => {
                const repo = targetDirs?.find( ( d ) => d.name === repoName )

                return repo
                    ? `- ${repo.name}: ${repo.path}`
                    : `- ${repoName}: (path unknown)`
            } )

        return { formatted: lines.join( '\n' ) }
    }


    static formatCodeContext( { codeContext } ) {
        if( !codeContext || codeContext.length === 0 ) {
            return { formatted: 'None provided.' }
        }

        const lines = codeContext
            .map( ( ctx ) => `- [${ctx.repo}] ${ctx.path}: ${ctx.purpose}` )

        return { formatted: lines.join( '\n' ) }
    }


    static formatConstraints( { constraints } ) {
        if( !constraints || constraints.length === 0 ) {
            return { formatted: 'None provided.' }
        }

        const lines = constraints
            .map( ( c ) => `- ${c}` )

        return { formatted: lines.join( '\n' ) }
    }


    // === PATH VALIDATION ===

    static async validatePaths( { prd, workingDir } ) {
        const errors = []
        const warnings = []

        // 1. Validate targetDirs
        if( prd.targetDirs && prd.targetDirs.length > 0 ) {
            const targetDirChecks = prd.targetDirs
                .map( async ( dir ) => {
                    const absolutePath = path.isAbsolute( dir.path )
                        ? dir.path
                        : path.join( workingDir, dir.path )

                    // Check if directory exists
                    try {
                        await fs.access( absolutePath )
                    } catch {
                        errors.push( `targetDir "${dir.name}": Directory not found at ${dir.path}` )

                        return
                    }

                    // Check if it's a git repo
                    const gitPath = path.join( absolutePath, '.git' )
                    try {
                        await fs.access( gitPath )
                    } catch {
                        warnings.push( `targetDir "${dir.name}": No .git folder found (not a git repository)` )
                    }
                } )

            await Promise.all( targetDirChecks )
        }

        // 2. Validate codeContext paths in user stories
        if( prd.userStories && prd.userStories.length > 0 ) {
            const codeContextChecks = prd.userStories
                .flatMap( ( story ) => {
                    if( !story.codeContext || story.codeContext.length === 0 ) {
                        return []
                    }

                    return story.codeContext
                        .map( async ( ctx ) => {
                            // Find the repo path
                            const repo = prd.targetDirs?.find( ( d ) => d.name === ctx.repo )
                            if( !repo ) {
                                errors.push( `${story.id} codeContext: Unknown repo "${ctx.repo}" for path "${ctx.path}"` )

                                return
                            }

                            // Build absolute path
                            const repoPath = path.isAbsolute( repo.path )
                                ? repo.path
                                : path.join( workingDir, repo.path )

                            const filePath = path.join( repoPath, ctx.path )

                            // Check if file exists
                            try {
                                await fs.access( filePath )
                            } catch {
                                warnings.push( `${story.id} codeContext: File not found "${ctx.repo}/${ctx.path}"` )
                            }
                        } )
                } )

            await Promise.all( codeContextChecks )
        }

        // 3. Validate affectedRepos reference existing targetDirs
        if( prd.userStories && prd.userStories.length > 0 ) {
            const targetDirNames = new Set( prd.targetDirs?.map( ( d ) => d.name ) || [] )

            prd.userStories
                .forEach( ( story ) => {
                    if( story.affectedRepos && story.affectedRepos.length > 0 ) {
                        story.affectedRepos
                            .forEach( ( repoName ) => {
                                if( !targetDirNames.has( repoName ) ) {
                                    errors.push( `${story.id} affectedRepos: Unknown repo "${repoName}"` )
                                }
                            } )
                    }
                } )
        }

        // Return validation results (output handled by caller)
        const valid = errors.length === 0

        return { valid, errors, warnings }
    }


    // === INITIALIZATION ===

    static async init( { prdPath, workingDir, repos = null, configPath = null, templateSet = 'default' } ) {
        // Read PRD content
        let prdContent
        try {
            prdContent = await fs.readFile( prdPath, 'utf-8' )
        } catch {
            Print.fail( { message: `Could not read PRD file: ${prdPath}` } )

            return { success: false, exitCode: EXIT_CODES.FILE_NOT_FOUND }
        }

        // Use passed repos or discover them
        let targetRepos = repos
        if( !targetRepos ) {
            const discovered = await this.discoverGitRepos( { workingDir } )
            targetRepos = discovered.repos
        }

        if( targetRepos.length === 0 ) {
            Print.warning( { message: 'No git repositories found' } )
        }

        // Load converter template
        const { template } = await this.loadTemplate( { templateName: 'converter', configPath, templateSet } )
        const { projectName } = this.extractProjectName( { prdPath } )

        // Load set config for conversion options
        const { setConfig } = await UserConfig.loadSetConfig( { configPath, setName: templateSet } )
        const { config: conversionConfig } = UserConfig.getToolConfig( { setConfig, phase: 'conversion' } )

        // Load system prompt path
        const { systemPromptPath } = await this.loadSystemPromptPath( { configPath, templateSet } )

        // Format target dirs for prompt
        const { formatted: targetDirsFormatted } = this.formatTargetDirs( { targetDirs: targetRepos } )

        // Extract prdId from filename for task list ID
        const basename = path.basename( prdPath )
        const prdIdMatch = basename.match( /^(PRD-[A-Z]+-\d+)/ )
        const prdIdForTaskList = prdIdMatch ? prdIdMatch[ 1 ] : projectName

        // Build prompt
        const { prompt } = this.buildPrompt( {
            template,
            replacements: {
                'PRD_CONTENT': prdContent,
                'PROJECT_NAME': projectName,
                'WORKING_DIR': workingDir,
                'PRD_FILENAME': basename,
                'TARGET_DIRS': targetDirsFormatted
            }
        } )

        // Create ralph directory early for logging
        const { ralphDir } = this.getRalphDir( { prdPath } )
        await fs.mkdir( ralphDir, { recursive: true } )

        // Start conversion table
        Print.tableConversionStart()

        // Call Claude with table progress display and config
        const { output, error, usage, contextManagement, structuredOutput } = await this.callClaude( {
            prompt,
            workingDir,
            tableMode: 'conversion',
            toolConfig: conversionConfig,
            prdId: prdIdForTaskList,
            taskId: null,
            phase: 'conversion',
            systemPromptFile: systemPromptPath
        } )

        // Calculate final progress values
        const finalTokens = usage ? ( usage.inputTokens + usage.cacheCreation ) : 0
        const finalContextWindow = usage?.contextWindow || 200000
        const finalPercentage = finalContextWindow > 0 ? Math.round( ( finalTokens / finalContextWindow ) * 100 ) : 0

        // Log output immediately - even on error (output may contain useful info)
        await this.saveTaskLog( {
            ralphDir,
            taskId: 'conversion',
            phase: 'conversion',
            output,
            usage,
            error: error?.message || null,
            contextManagement
        } )

        // Accumulate usage stats from conversion
        if( usage ) {
            this.#usageStats.totalInputTokens += usage.inputTokens
            this.#usageStats.totalOutputTokens += usage.outputTokens
            this.#usageStats.totalCacheRead += usage.cacheRead
            this.#usageStats.totalCacheCreation += usage.cacheCreation
            this.#usageStats.totalCost += usage.costUsd
            this.#usageStats.taskCount += 1
            this.#usageStats.contextWindow = usage.contextWindow
        }

        // Use structuredOutput if available (even on error - Claude bug workaround)
        let prd = null

        if( structuredOutput ) {
            // Got structured output directly from Claude - use it!
            prd = structuredOutput
        } else if( error ) {
            // No structured output and error - fail
            Print.tableConversionUpdate( {
                percentage: finalPercentage,
                tokens: finalTokens,
                contextWindow: finalContextWindow,
                status: 'Failed',
                spinnerFrame: '✗'
            } )

            return { success: false, exitCode: EXIT_CODES.CLAUDE_ERROR }
        } else {
            // No structured output, no error - try to extract JSON from text
            const { json, error: parseError } = this.extractJson( { text: output } )

            if( parseError ) {
                Print.tableConversionUpdate( {
                    percentage: finalPercentage,
                    tokens: finalTokens,
                    contextWindow: finalContextWindow,
                    status: 'JSON parse error',
                    spinnerFrame: '✗'
                } )

                return { success: false, exitCode: EXIT_CODES.SCHEMA_INVALID }
            }

            prd = json
        }

        // Display context management info if present and fail if compacted
        if( contextManagement ) {
            Print.contextManagementInfo( { contextManagement } )
            Print.fail( { message: 'Context was compacted - task too large. Consider splitting into smaller tasks.' } )

            return { success: false, exitCode: EXIT_CODES.TASK_FAILED }
        }

        // Extract prdId from filename if not provided by Claude
        if( !prd.prdId ) {
            const basename = path.basename( prdPath )
            const prdIdMatch = basename.match( /^(PRD-[A-Z]+-\d+)/ )
            prd.prdId = prdIdMatch ? prdIdMatch[ 1 ] : prd.id
        }

        // Check constraintsValid (PRD-level validation from Claude)
        if( prd.constraintsValid === false ) {
            Print.fail( { message: 'PRD violates constraints:' } )
            const constraintErrors = prd.constraintErrors || []
            constraintErrors
                .forEach( ( err ) => {
                    Print.warning( { message: err, indent: 2 } )
                } )

            return { success: false, exitCode: EXIT_CODES.SCHEMA_INVALID }
        }

        // Ensure targetDirs from discovery if not in response
        if( !prd.targetDirs || prd.targetDirs.length === 0 ) {
            prd.targetDirs = targetRepos
        }

        // Ensure workingDir is set
        prd.workingDir = workingDir

        // Validate all paths before proceeding
        const { valid, errors, warnings } = await this.validatePaths( { prd, workingDir } )

        if( warnings.length > 0 ) {
            Print.keyValue( { key: 'Warnings', value: `${warnings.length} found` } )
            warnings
                .forEach( ( w ) => {
                    Print.warning( { message: w, indent: 2 } )
                } )
        }

        if( !valid ) {
            Print.keyValue( { key: 'Errors', value: `${errors.length} found` } )
            errors
                .forEach( ( e ) => {
                    Print.fail( { message: e, indent: 2 } )
                } )

            return { success: false, exitCode: EXIT_CODES.SCHEMA_INVALID, errors }
        }

        // Create progress object
        const progress = {
            prdId: prd.id,
            startedAt: new Date().toISOString(),
            completedAt: null,
            completedTasks: [],
            currentTask: null,
            status: 'initialized',
            totalTasks: prd.userStories?.length || 0,
            lastError: null,
            summary: null,
            templateSet: templateSet,
            configPath: configPath
        }

        // Save state (ralphDir was created earlier for logging)
        await this.saveState( { ralphDir, prd, progress } )

        // Display final conversion table
        Print.tableConversionDone( {
            percentage: finalPercentage,
            tokens: finalTokens,
            contextWindow: finalContextWindow,
            userStories: prd.userStories?.length || 0,
            stateDir: `${path.basename( ralphDir )}/`
        } )

        return { success: true, prd, progress, ralphDir }
    }


    // === EXECUTION ===

    static async executeTask( { task, prd, progress, workingDir, ralphDir, configPath = null, templateSet = 'default' } ) {
        // Load executor template
        const { template } = await this.loadTemplate( { templateName: 'executor', configPath, templateSet } )

        // Load set config for task options
        const { setConfig } = await UserConfig.loadSetConfig( { configPath, setName: templateSet } )
        const { config: taskConfig } = UserConfig.getToolConfig( { setConfig, phase: 'task' } )
        const skipContext = taskConfig?.skipContext || false

        // Load system prompt path
        const { systemPromptPath } = await this.loadSystemPromptPath( { configPath, templateSet } )

        // Format context (optionally skip based on config)
        const { formatted: completedFormatted } = skipContext
            ? { formatted: 'Task context disabled.' }
            : this.formatCompletedTasks( {
                userStories: prd.userStories,
                completedIds: progress.completedTasks
            } )

        const { formatted: targetDirsFormatted } = this.formatTargetDirs( {
            targetDirs: prd.targetDirs
        } )

        const { formatted: affectedReposFormatted } = this.formatAffectedRepos( {
            affectedRepos: task.affectedRepos,
            targetDirs: prd.targetDirs
        } )

        const { formatted: codeContextFormatted } = this.formatCodeContext( {
            codeContext: task.codeContext
        } )

        const { formatted: constraintsFormatted } = this.formatConstraints( {
            constraints: task.constraints
        } )

        // Build prompt
        const { prompt } = this.buildPrompt( {
            template,
            replacements: {
                'PRD_ID': prd.prdId || prd.id,
                'PROJECT_NAME': prd.title,
                'BRANCH_NAME': prd.branchName,
                'WORKING_DIR': workingDir,
                'RALPH_DIR': ralphDir,
                'TARGET_DIRS': targetDirsFormatted,
                'COMPLETED_TASKS': completedFormatted,
                'CURRENT_TASK': JSON.stringify( task, null, 2 ),
                'TASK_ID': task.id,
                'AFFECTED_REPOS': affectedReposFormatted,
                'CODE_CONTEXT': codeContextFormatted,
                'CONSTRAINTS': constraintsFormatted,
                'PATTERN_EXAMPLE': task.patternExample || 'None provided.'
            }
        } )

        // Call Claude with table progress display and config
        const { output, error, usage, contextManagement, structuredOutput } = await this.callClaude( {
            prompt,
            workingDir,
            tableMode: 'task',
            toolConfig: taskConfig,
            prdId: prd.prdId || prd.id,
            taskId: task.id,
            phase: 'task',
            systemPromptFile: systemPromptPath
        } )

        // Calculate final progress values
        const taskTokens = usage ? ( usage.inputTokens + usage.cacheCreation ) : 0
        const taskContextWindow = usage?.contextWindow || 200000
        const taskPercentage = taskContextWindow > 0 ? Math.round( ( taskTokens / taskContextWindow ) * 100 ) : 0

        // Log output immediately - even on error (output may contain useful info)
        await this.saveTaskLog( {
            ralphDir,
            taskId: task.id,
            phase: 'task',
            output,
            usage,
            error: error?.message || null,
            contextManagement
        } )

        // Accumulate usage stats
        if( usage ) {
            this.#usageStats.totalInputTokens += usage.inputTokens
            this.#usageStats.totalOutputTokens += usage.outputTokens
            this.#usageStats.totalCacheRead += usage.cacheRead
            this.#usageStats.totalCacheCreation += usage.cacheCreation
            this.#usageStats.totalCost += usage.costUsd
            this.#usageStats.taskCount += 1
            this.#usageStats.contextWindow = usage.contextWindow
        }

        // Display context management info if present and fail if compacted
        if( contextManagement ) {
            Print.contextManagementInfo( { contextManagement } )
            Print.tableTaskFailed( {
                percentage: taskPercentage,
                tokens: taskTokens,
                contextWindow: taskContextWindow,
                message: 'Context compacted - task too large'
            } )

            return { success: false, updatedTask: null, exitCode: EXIT_CODES.TASK_FAILED }
        }

        // Use structuredOutput if available (even on error - Claude bug workaround)
        let updatedTask = null

        if( structuredOutput ) {
            // Got structured output directly from Claude - use it!
            updatedTask = structuredOutput
        } else if( error ) {
            // No structured output and error - fail
            Print.tableTaskFailed( {
                percentage: taskPercentage,
                tokens: taskTokens,
                contextWindow: taskContextWindow,
                message: `Claude Code error: ${error.message}`
            } )
            await this.saveError( { ralphDir, taskId: task.id, error } )

            return { success: false, updatedTask: null, exitCode: EXIT_CODES.CLAUDE_ERROR }
        } else {
            // No structured output, no error - try to extract JSON from text
            const { json, error: parseError } = this.extractJson( { text: output } )

            if( parseError ) {
                Print.tableTaskFailed( {
                    percentage: taskPercentage,
                    tokens: taskTokens,
                    contextWindow: taskContextWindow,
                    message: 'Could not parse response as JSON'
                } )
                const err = new Error( 'JSON parse error: ' + output.substring( 0, 200 ) )
                await this.saveError( { ralphDir, taskId: task.id, error: err } )

                return { success: false, updatedTask: null, exitCode: EXIT_CODES.SCHEMA_INVALID }
            }

            updatedTask = json
        }

        // Check security check first
        const securityCheck = updatedTask.securityCheck || { passed: true, issues: [] }
        if( !securityCheck.passed ) {
            Print.tableTaskFailed( {
                percentage: taskPercentage,
                tokens: taskTokens,
                contextWindow: taskContextWindow,
                message: 'Security check failed'
            } )

            return { success: false, updatedTask, exitCode: EXIT_CODES.TASK_FAILED }
        }

        // Check result
        if( updatedTask.passes ) {
            const commits = updatedTask.commits || []
            const changedFiles = updatedTask.changedFiles || []
            const firstCommit = commits.length > 0 ? commits[ 0 ] : null

            Print.tableTaskDone( {
                percentage: taskPercentage,
                tokens: taskTokens,
                contextWindow: taskContextWindow,
                commitHash: firstCommit?.commitHash || null,
                changedFiles: changedFiles.length
            } )

            // Show critical notes (outside table)
            const criticalNotes = updatedTask.criticalNotes || []
            if( criticalNotes.length > 0 ) {
                Print.criticalNotes( { notes: criticalNotes } )
            }

            return { success: true, updatedTask, exitCode: EXIT_CODES.SUCCESS }
        } else if( updatedTask.status === 'blocked' ) {
            Print.tableTaskFailed( {
                percentage: taskPercentage,
                tokens: taskTokens,
                contextWindow: taskContextWindow,
                message: updatedTask.notes || 'Blocked'
            } )

            return { success: false, updatedTask, exitCode: EXIT_CODES.TASK_BLOCKED }
        } else {
            Print.tableTaskFailed( {
                percentage: taskPercentage,
                tokens: taskTokens,
                contextWindow: taskContextWindow,
                message: updatedTask.notes || 'Failed'
            } )

            return { success: false, updatedTask, exitCode: EXIT_CODES.TASK_FAILED }
        }
    }


    // === MAIN RUN LOOP ===

    static async run( { prdPath, workingDir, dryRun = false, configPath = null, templateSet = 'default' } ) {
        const absolutePrdPath = path.resolve( prdPath )

        // Discover repos first for header
        const { repos } = await this.discoverGitRepos( { workingDir } )

        // Get ralph dir for log file path (relative to workingDir)
        const { ralphDir: logDir } = this.getRalphDir( { prdPath: absolutePrdPath } )
        const logFileAbsolute = path.join( logDir, 'task.log' )
        const logFile = path.relative( workingDir, logFileAbsolute )

        // Print header (key-value format)
        Print.header( {
            version: '0.2.0',
            prdFile: path.basename( prdPath ),
            workingDir,
            repos: repos.length,
            logFile
        } )

        // Check for existing project
        const { exists, ralphDir, prd: existingPrd, progress: existingProgress } = await this.checkExistingProject( { prdPath: absolutePrdPath } )

        let prd, progress

        let activeTemplateSet = templateSet
        let activeConfigPath = configPath

        if( exists && existingPrd && existingProgress ) {
            Print.newline()
            Print.keyValue( { key: 'State', value: `${path.basename( ralphDir )}/` } )
            Print.keyValue( { key: 'Progress', value: `${existingProgress.completedTasks.length}/${existingProgress.totalTasks} completed` } )

            prd = existingPrd
            progress = existingProgress

            // Use stored templateSet and configPath from progress
            if( progress.templateSet ) {
                // Reject if user tries to use different set
                if( templateSet !== 'default' && templateSet !== progress.templateSet ) {
                    Print.fail( { message: `Cannot change template set for existing project.` } )
                    Print.newline()
                    Print.info( { message: 'This PRD was started with a specific skill set:' } )
                    Print.newline()
                    Print.keyValue( { key: 'PRD', value: prd.prdId || prd.id, indent: 2 } )
                    Print.keyValue( { key: 'Skill Set', value: progress.templateSet, indent: 2 } )
                    Print.keyValue( { key: 'Requested', value: templateSet, indent: 2 } )
                    Print.newline()
                    Print.info( { message: 'To use a different skill set, delete the .ralph folder first:' } )
                    Print.info( { message: `  rm -rf ${ralphDir}`, indent: 2 } )

                    return { exitCode: EXIT_CODES.INVALID_ARGS }
                }
                activeTemplateSet = progress.templateSet
                activeConfigPath = progress.configPath || configPath
                Print.keyValue( { key: 'Skill Set', value: activeTemplateSet } )
            }

            if( progress.status === 'completed' ) {
                Print.tableSummaryComplete( {
                    completed: existingProgress.completedTasks.length,
                    total: existingProgress.totalTasks,
                    branch: prd.branchName
                } )

                return { exitCode: EXIT_CODES.SUCCESS }
            }
        } else {
            const initResult = await this.init( { prdPath: absolutePrdPath, workingDir, repos, configPath, templateSet } )

            if( !initResult.success ) {
                return { exitCode: initResult.exitCode }
            }

            prd = initResult.prd
            progress = initResult.progress
        }

        // Dry run check
        if( dryRun ) {
            Print.newline()
            Print.separator()
            Print.info( { message: 'DRY RUN - Would execute:' } )
            Print.newline()

            prd.userStories
                .forEach( ( story, idx ) => {
                    const status = progress.completedTasks.includes( story.id ) ? 'DONE' : 'TODO'
                    const repos = story.affectedRepos?.join( ', ' ) || 'all'
                    Print.taskHeader( {
                        index: idx + 1,
                        total: prd.userStories.length,
                        taskId: story.id,
                        title: story.title,
                        repos
                    } )
                    Print.info( { message: `Status: ${status}`, indent: 6 } )
                } )

            return { exitCode: EXIT_CODES.SUCCESS }
        }

        // Reset usage stats for this run
        this.#resetUsageStats()

        // Update progress status
        progress.status = 'running'
        await this.saveState( { ralphDir, prd, progress } )

        Print.newline()
        Print.separator()

        // Main execution loop
        let continueLoop = true
        let exitCode = EXIT_CODES.SUCCESS

        while( continueLoop ) {
            const { nextTask } = this.findNextTask( {
                userStories: prd.userStories,
                completedIds: progress.completedTasks
            } )

            if( !nextTask ) {
                // Check if all done or blocked
                const allDone = prd.userStories
                    .every( ( s ) => s.status === 'completed' || progress.completedTasks.includes( s.id ) )

                if( allDone ) {
                    progress.status = 'completed'
                    progress.completedAt = new Date().toISOString()

                    // Collect all commits across all stories
                    const allCommits = prd.userStories
                        .flatMap( ( s ) => s.commits || [] )

                    progress.summary = `All ${progress.totalTasks} tasks completed. ${allCommits.length} commits across ${prd.targetDirs?.length || 0} repos.`

                    Print.summary( {
                        completed: progress.totalTasks,
                        total: progress.totalTasks,
                        commits: allCommits.length,
                        branch: prd.branchName
                    } )

                    // Display total usage
                    if( this.#usageStats.taskCount > 0 ) {
                        Print.totalUsage( {
                            totalInputTokens: this.#usageStats.totalInputTokens,
                            totalOutputTokens: this.#usageStats.totalOutputTokens,
                            taskCount: this.#usageStats.taskCount
                        } )
                    }
                } else {
                    progress.status = 'blocked'
                    Print.newline()
                    Print.separator()
                    Print.warning( { message: 'No executable tasks found (dependencies not met or all blocked/failed)' } )
                }

                await this.saveState( { ralphDir, prd, progress } )
                continueLoop = false

                break
            }

            // Execute task
            const taskIndex = prd.userStories.findIndex( ( s ) => s.id === nextTask.id )
            const affectedRepos = nextTask.affectedRepos?.join( ', ' ) || 'all'
            Print.tableTaskStart( {
                index: taskIndex + 1,
                total: prd.userStories.length,
                taskId: nextTask.id,
                title: nextTask.title,
                repo: affectedRepos
            } )

            progress.currentTask = nextTask.id
            await this.saveState( { ralphDir, prd, progress } )

            const { success, updatedTask, exitCode: taskExitCode } = await this.executeTask( {
                task: nextTask,
                prd,
                progress,
                workingDir,
                ralphDir,
                configPath: activeConfigPath,
                templateSet: activeTemplateSet
            } )

            // Update PRD with result
            if( updatedTask ) {
                prd.userStories[ taskIndex ] = updatedTask
            }

            if( success ) {
                progress.completedTasks.push( nextTask.id )
                progress.currentTask = null
            } else {
                // Stop on failure/block
                progress.currentTask = null
                progress.status = taskExitCode === EXIT_CODES.TASK_BLOCKED ? 'blocked' : 'paused'
                progress.lastError = {
                    taskId: nextTask.id,
                    message: updatedTask?.notes || 'Task failed',
                    timestamp: new Date().toISOString()
                }

                exitCode = taskExitCode
                continueLoop = false
            }

            await this.saveState( { ralphDir, prd, progress } )
        }

        // Final summary
        Print.newline()
        Print.separator()

        if( exitCode !== EXIT_CODES.SUCCESS ) {
            Print.fail( { message: `Stopped at: ${progress.lastError?.taskId || 'unknown'}` } )
            Print.keyValue( { key: 'Completed', value: `${progress.completedTasks.length}/${progress.totalTasks}` } )
            Print.keyValue( { key: 'State', value: `${path.basename( ralphDir )}/progress.json` } )

            // Collect all commits from completed tasks for revert instructions
            const allCommits = prd.userStories
                .filter( ( s ) => progress.completedTasks.includes( s.id ) )
                .flatMap( ( s ) => s.commits || [] )

            if( allCommits.length > 0 ) {
                Print.showRevertInstructions( { commits: allCommits } )
            }

            Print.newline()
            Print.info( { message: `To continue: ralph ${path.basename( prdPath )}` } )
        }

        // Display total usage summary if any tasks were executed
        if( this.#usageStats.taskCount > 0 ) {
            Print.totalUsage( {
                totalInputTokens: this.#usageStats.totalInputTokens,
                totalOutputTokens: this.#usageStats.totalOutputTokens,
                taskCount: this.#usageStats.taskCount
            } )
        }

        return { exitCode }
    }


    // === STATUS ===

    static async status( { prdPath } ) {
        const absolutePrdPath = path.resolve( prdPath )
        const { exists, ralphDir, prd, progress } = await this.checkExistingProject( { prdPath: absolutePrdPath } )

        console.log( '' )
        console.log( 'Ralph Loop - Status' )
        console.log( '-------------------' )
        console.log( '' )
        console.log( `PRD: ${path.basename( prdPath )}` )

        if( !exists || !prd || !progress ) {
            console.log( '  -> No existing project found' )
            console.log( '  -> Run `ralph <prd-file>` to start' )

            return { exitCode: EXIT_CODES.SUCCESS }
        }

        console.log( `  -> Project: ${prd.title}` )
        console.log( `  -> Branch: ${prd.branchName}` )
        console.log( `  -> Status: ${progress.status}` )
        console.log( `  -> Progress: ${progress.completedTasks.length}/${progress.totalTasks}` )

        console.log( '' )
        console.log( 'Target Repositories:' )
        prd.targetDirs
            ?.forEach( ( dir ) => {
                console.log( `  - ${dir.name}: ${dir.path}` )
            } )

        console.log( '' )
        console.log( 'User Stories:' )

        prd.userStories
            .forEach( ( story, idx ) => {
                const isDone = progress.completedTasks.includes( story.id )
                const status = isDone ? 'DONE' : story.status.toUpperCase()

                // Format commits
                const commits = story.commits || []

                console.log( `  [${idx + 1}] ${story.id}: ${story.title} - ${status}` )
                if( commits.length > 0 ) {
                    commits
                        .forEach( ( c ) => {
                            console.log( `      -> ${c.repo} (${c.repoPath}): ${c.commitHash?.substring( 0, 7 )}` )
                        } )
                }
            } )

        if( progress.lastError ) {
            console.log( '' )
            console.log( 'Last Error:' )
            console.log( `  Task: ${progress.lastError.taskId}` )
            console.log( `  Message: ${progress.lastError.message}` )
        }

        return { exitCode: EXIT_CODES.SUCCESS }
    }
}


export { RalphLoop, EXIT_CODES }
