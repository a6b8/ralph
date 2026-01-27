import chalk from 'chalk'


class Print {
    static #spinnerFrames = [ '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏' ]
    static #spinnerIndex = 0
    static #spinnerInterval = null
    static #currentStatus = ''
    static #isSpinning = false
    static #keyWidth = 14
    static #currentTokens = 0
    static #contextWindow = 200000

    // Table constants
    static #TABLE_WIDTH = 80
    static #LABEL_WIDTH = 16
    static #VALUE_WIDTH = 61


    // === ANSI HELPERS ===

    static #clearLine() {
        process.stdout.write( '\r\x1b[K' )
    }


    static #moveCursorUp( lines = 1 ) {
        process.stdout.write( `\x1b[${lines}A` )
    }


    // === HEADER & KEY-VALUE ===

    static header( { version, prdFile, workingDir, repos, logFile } ) {
        console.log( '' )
        this.keyValue( { key: 'Version', value: version } )
        this.keyValue( { key: 'PRD', value: prdFile } )
        this.keyValue( { key: 'Working Dir', value: workingDir } )
        this.keyValue( { key: 'Repositories', value: `${repos} found` } )
        this.keyValue( { key: 'Log', value: logFile } )
        console.log( '' )
    }


    static keyValue( { key, value, indent = 0 } ) {
        const padding = ' '.repeat( indent )
        const keyStr = `${key}:`.padEnd( this.#keyWidth )

        console.log( `${padding}${chalk.gray( keyStr )} ${value}` )
    }


    static info( { message, indent = 0 } ) {
        const padding = ' '.repeat( indent )

        console.log( `${padding}${chalk.gray( '→' )} ${message}` )
    }


    static success( { message, indent = 0 } ) {
        const padding = ' '.repeat( indent )

        console.log( `${padding}${chalk.green( '✓' )} ${message}` )
    }


    static warning( { message, indent = 0 } ) {
        const padding = ' '.repeat( indent )

        console.log( `${padding}${chalk.yellow( '!' )} ${message}` )
    }


    static fail( { message, indent = 0 } ) {
        const padding = ' '.repeat( indent )

        console.log( `${padding}${chalk.red( '✗' )} ${message}` )
    }


    static newline() {
        console.log( '' )
    }


    // === SPINNER ===

    static #spinnerLabel = ''


    static startSpinner( { label, message } ) {
        this.#spinnerLabel = label || ''
        this.#currentStatus = message
        this.#isSpinning = true
        this.#spinnerIndex = 0
        this.#currentTokens = 0
        this.#contextWindow = 200000

        this.#renderSpinner()

        this.#spinnerInterval = setInterval( () => {
            this.#spinnerIndex = ( this.#spinnerIndex + 1 ) % this.#spinnerFrames.length
            this.#renderSpinner()
        }, 80 )
    }


    static #renderSpinner() {
        const frame = this.#spinnerFrames[ this.#spinnerIndex ]

        this.#clearLine()

        // Build progress bar if we have token data
        let progressPart = ''
        if( this.#currentTokens > 0 ) {
            const percentage = Math.round( ( this.#currentTokens / this.#contextWindow ) * 100 )
            const bar = this.#renderProgressBar( { percentage, width: 15 } )
            const tokenK = Math.round( this.#currentTokens / 1000 )
            progressPart = ` ${bar} ${percentage}% (${tokenK}k)`
        }

        if( this.#spinnerLabel ) {
            const keyStr = `${this.#spinnerLabel}:`.padEnd( this.#keyWidth )
            process.stdout.write( `${chalk.gray( keyStr )}${progressPart} ${chalk.cyan( frame )} ${this.#currentStatus}` )
        } else {
            process.stdout.write( `      ${progressPart} ${chalk.cyan( frame )} ${this.#currentStatus}` )
        }
    }


    static updateTokens( { tokens, contextWindow } ) {
        this.#currentTokens = tokens
        this.#contextWindow = contextWindow || 200000

        if( this.#isSpinning ) {
            this.#renderSpinner()
        }
    }


    static updateSpinner( { message } ) {
        this.#currentStatus = message

        if( this.#isSpinning ) {
            this.#renderSpinner()
        }
    }


    static stopSpinner( { success = true, message = null } ) {
        if( this.#spinnerInterval ) {
            clearInterval( this.#spinnerInterval )
            this.#spinnerInterval = null
        }

        this.#isSpinning = false
        this.#clearLine()

        const icon = success ? chalk.green( '✓' ) : chalk.red( '✗' )
        const text = message || this.#currentStatus

        if( this.#spinnerLabel ) {
            const keyStr = `${this.#spinnerLabel}:`.padEnd( this.#keyWidth )
            process.stdout.write( `${chalk.gray( keyStr )} ${icon} ${text}\n` )
        } else {
            process.stdout.write( `      ${icon} ${text}\n` )
        }

        this.#spinnerLabel = ''
    }


    // === STREAM PARSER ===

    static parseStreamChunk( { chunk, buffer } ) {
        const newBuffer = buffer + chunk
        const lines = newBuffer.split( '\n' )
        const events = []

        // Process all complete lines
        const completeLines = lines.slice( 0, -1 )
        const remainingBuffer = lines[ lines.length - 1 ]

        completeLines
            .forEach( ( line ) => {
                if( !line.trim() ) {
                    return
                }

                try {
                    const event = JSON.parse( line )
                    events.push( event )
                } catch {
                    // Not valid JSON, skip
                }
            } )

        return { events, buffer: remainingBuffer }
    }


    static getStatusFromEvent( { event } ) {
        const { type } = event

        if( type === 'system' && event.subtype === 'init' ) {
            return { status: 'Initializing...', type: 'init' }
        }

        if( type === 'assistant' && event.message?.content ) {
            const content = event.message.content

            // Check for tool use
            const toolUse = content.find( ( c ) => c.type === 'tool_use' )
            if( toolUse ) {
                const { name, input } = toolUse
                const statusText = this.#formatToolStatus( { name, input } )

                return { status: statusText, type: 'tool' }
            }

            // Check for text (thinking/response)
            const textContent = content.find( ( c ) => c.type === 'text' )
            if( textContent?.text ) {
                const preview = textContent.text.substring( 0, 50 ).replace( /\n/g, ' ' )

                return { status: `Generating...`, type: 'text' }
            }
        }

        if( type === 'user' && event.tool_use_result ) {
            return { status: 'Processing result...', type: 'result' }
        }

        if( type === 'result' ) {
            const success = event.subtype === 'success'

            return { status: success ? 'Complete' : 'Failed', type: 'done', success }
        }

        return { status: null, type: 'unknown' }
    }


    static #formatToolStatus( { name, input } ) {
        const toolName = name.toLowerCase()

        if( toolName === 'read' ) {
            const filePath = input?.file_path || ''
            const fileName = filePath.split( '/' ).pop()

            return `Reading ${fileName}...`
        }

        if( toolName === 'write' ) {
            const filePath = input?.file_path || ''
            const fileName = filePath.split( '/' ).pop()

            return `Writing ${fileName}...`
        }

        if( toolName === 'edit' ) {
            const filePath = input?.file_path || ''
            const fileName = filePath.split( '/' ).pop()

            return `Editing ${fileName}...`
        }

        if( toolName === 'bash' ) {
            const cmd = input?.command || ''

            // Git-Befehle schöner anzeigen
            if( cmd.includes( 'git commit' ) ) return 'Committing changes...'
            if( cmd.includes( 'git add' ) ) return 'Staging changes...'
            if( cmd.includes( 'git checkout' ) ) return 'Switching branch...'
            if( cmd.includes( 'git push' ) ) return 'Pushing changes...'
            if( cmd.includes( 'git pull' ) ) return 'Pulling changes...'
            if( cmd.includes( 'git merge' ) ) return 'Merging...'
            if( cmd.includes( 'git rebase' ) ) return 'Rebasing...'
            if( cmd.includes( 'git stash' ) ) return 'Stashing changes...'

            const shortCmd = cmd.substring( 0, 30 )

            return `Running: ${shortCmd}${cmd.length > 30 ? '...' : ''}`
        }

        if( toolName === 'glob' ) {
            const pattern = input?.pattern || ''

            return `Searching: ${pattern}`
        }

        if( toolName === 'grep' ) {
            const pattern = input?.pattern || ''

            return `Searching: ${pattern}`
        }

        return `${name}...`
    }


    // === TASK DISPLAY ===

    static taskHeader( { index, total, taskId, title, repos } ) {
        const progress = chalk.gray( `[${index}/${total}]` )

        console.log( `${progress} ${chalk.bold( taskId )}: ${title}` )
        this.keyValue( { key: 'Repos', value: repos, indent: 6 } )
    }


    static taskSuccess( { commits = [] } ) {
        if( commits.length > 0 ) {
            commits
                .forEach( ( c ) => {
                    const hash = c.commitHash?.substring( 0, 7 ) || 'no hash'
                    this.info( { message: `${c.repo}: ${chalk.gray( hash )}`, indent: 6 } )
                } )
        }
    }


    static taskFailed( { message } ) {
        this.fail( { message, indent: 6 } )
    }


    static taskBlocked( { message } ) {
        this.warning( { message, indent: 6 } )
    }


    static changeSummary( { repo, files } ) {
        this.keyValue( { key: 'Changes', value: `${files.length} files in ${repo}`, indent: 6 } )

        files
            .forEach( ( { path: filePath, action } ) => {
                const icon = action === 'added' ? chalk.green( '+' )
                           : action === 'moved' ? chalk.red( '-' )
                           : chalk.yellow( '~' )
                console.log( `        ${icon} ${filePath}` )
            } )
    }


    static criticalNotes( { notes } ) {
        if( !notes || notes.length === 0 ) {
            return
        }

        console.log( `      ${chalk.yellow( '⚠' )} ${chalk.yellow( 'Critical Notes:' )}` )

        notes
            .forEach( ( { type, note } ) => {
                console.log( `        ${chalk.yellow( `[${type}]` )} ${note}` )
            } )
    }


    static showRevertInstructions( { commits } ) {
        console.log( '' )
        this.warning( { message: 'To revert Ralph changes:' } )

        commits
            .forEach( ( { repo, commitHash } ) => {
                console.log( `    cd ${repo}` )
                console.log( `    git revert ${commitHash}` )
                console.log( '' )
            } )

        // Or all at once
        if( commits.length > 1 ) {
            console.log( '  Or revert all:' )
            const hashes = commits.map( ( c ) => c.commitHash ).join( ' ' )
            console.log( `    git revert ${hashes}` )
        }
    }


    // === TOKEN USAGE DISPLAY ===

    static #renderProgressBar( { percentage, width = 20 } ) {
        const filled = Math.round( ( percentage / 100 ) * width )
        const empty = width - filled
        const color = percentage > 80 ? chalk.red : percentage > 60 ? chalk.yellow : chalk.green
        const bar = color( '█'.repeat( filled ) ) + chalk.gray( '░'.repeat( empty ) )

        return bar
    }


    static taskUsage( { inputTokens, outputTokens, cacheRead, cacheCreation, contextWindow } ) {
        const usedTokens = inputTokens + cacheCreation
        const percentage = Math.round( ( usedTokens / contextWindow ) * 100 )
        const bar = this.#renderProgressBar( { percentage, width: 20 } )

        console.log( '' )
        this.keyValue( { key: 'Tokens', value: `${usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} (${percentage}%)`, indent: 6 } )
        console.log( `        ${bar}` )

        if( cacheRead > 0 ) {
            this.keyValue( { key: 'Cache Hit', value: `${cacheRead.toLocaleString()} tokens`, indent: 6 } )
        }
    }


    static totalUsage( { totalInputTokens, totalOutputTokens, taskCount } ) {
        console.log( '' )
        this.separator()
        console.log( chalk.bold( 'Token Usage Summary' ) )
        this.keyValue( { key: 'Total Input', value: `${totalInputTokens.toLocaleString()} tokens` } )
        this.keyValue( { key: 'Total Output', value: `${totalOutputTokens.toLocaleString()} tokens` } )
        this.keyValue( { key: 'Tasks', value: `${taskCount}` } )
    }


    static compactingWarning( { percentage } ) {
        console.log( '' )
        console.log( chalk.yellow.bold( '⚠ APPROACHING CONTEXT LIMIT' ) )
        console.log( chalk.yellow( `   ${percentage}% of context window used` ) )
        console.log( chalk.yellow( '   Compacting may occur soon' ) )
    }


    static contextManagementInfo( { contextManagement } ) {
        if( !contextManagement ) {
            return
        }

        console.log( '' )
        console.log( chalk.cyan.bold( 'Context Management Active:' ) )
        console.log( chalk.cyan( `   ${JSON.stringify( contextManagement, null, 2 )}` ) )
    }


    // === SUMMARY DISPLAY ===

    static separator() {
        console.log( chalk.gray( '─'.repeat( 50 ) ) )
    }


    static summary( { completed, total, commits, branch } ) {
        console.log( '' )
        this.separator()
        console.log( chalk.green.bold( '✓ All tasks completed!' ) )
        console.log( `  Tasks: ${completed}/${total}` )
        console.log( `  Commits: ${commits}` )
        console.log( `  Branch: ${branch}` )
    }


    static error( { message } ) {
        console.log( chalk.red( `Error: ${message}` ) )
    }


    // === BOX-DRAWING TABLE ===

    static tableStart( { title } ) {
        const paddedTitle = title.padEnd( this.#TABLE_WIDTH - 4 )

        console.log( `┌${'─'.repeat( this.#TABLE_WIDTH - 2 )}┐` )
        console.log( `│ ${paddedTitle} │` )
        console.log( `├${'─'.repeat( this.#LABEL_WIDTH )}┬${'─'.repeat( this.#VALUE_WIDTH )}┤` )
    }


    static #stripAnsi( str ) {
        // Remove ANSI escape codes for length calculation
        return str.replace( /\x1b\[[0-9;]*m/g, '' )
    }


    static tableRow( { label, value } ) {
        const paddedLabel = label.padEnd( this.#LABEL_WIDTH - 2 )
        const valueStr = String( value )

        // Calculate visible length (without ANSI codes)
        const visibleLength = this.#stripAnsi( valueStr ).length
        const maxVisible = this.#VALUE_WIDTH - 2

        let displayValue = valueStr
        if( visibleLength > maxVisible ) {
            // Truncate - but we need to be careful with ANSI codes
            const stripped = this.#stripAnsi( valueStr )
            displayValue = stripped.substring( 0, maxVisible - 3 ) + '...'
        }

        // Calculate padding needed based on visible length
        const displayVisibleLength = this.#stripAnsi( displayValue ).length
        const paddingNeeded = maxVisible - displayVisibleLength
        const paddedValue = displayValue + ' '.repeat( Math.max( 0, paddingNeeded ) )

        console.log( `│ ${paddedLabel} │ ${paddedValue} │` )
    }


    static tableEnd() {
        console.log( `└${'─'.repeat( this.#LABEL_WIDTH )}┴${'─'.repeat( this.#VALUE_WIDTH )}┘` )
    }


    static tableUpdateRows( { rows } ) {
        process.stdout.write( `\x1b[${rows.length}A` )

        rows
            .forEach( ( { label, value } ) => {
                this.#clearLine()
                this.tableRow( { label, value } )
            } )
    }


    static formatProgress( { percentage, tokens, contextWindow } ) {
        const bar = this.#renderProgressBar( { percentage, width: 30 } )
        const tokenK = Math.round( tokens / 1000 )
        const contextK = Math.round( contextWindow / 1000 )

        return `${bar} ${percentage}% (${tokenK}k/${contextK}k)`
    }


    static tableHeader( { version, prdFile, workingDir, repos } ) {
        this.tableStart( { title: `Ralph Loop v${version}` } )
        this.tableRow( { label: 'PRD', value: prdFile } )
        this.tableRow( { label: 'Working Dir', value: workingDir } )
        this.tableRow( { label: 'Repositories', value: `${repos} found` } )
        this.tableEnd()
    }


    static tableConversionStart() {
        console.log( '' )
        this.tableStart( { title: 'PRD Conversion' } )
        this.tableRow( { label: 'Progress', value: this.formatProgress( { percentage: 0, tokens: 0, contextWindow: 200000 } ) } )
        this.tableRow( { label: 'Status', value: '⠋ Initializing...' } )
        this.tableEnd()
    }


    static tableConversionUpdate( { percentage, tokens, contextWindow, status, spinnerFrame } ) {
        const frame = spinnerFrame || '⠸'

        // Build all lines first
        const progressValue = this.formatProgress( { percentage, tokens, contextWindow } )
        const statusValue = `${frame} ${status}`

        const progressLabel = 'Progress'.padEnd( this.#LABEL_WIDTH - 2 )
        const statusLabel = 'Status'.padEnd( this.#LABEL_WIDTH - 2 )

        const progressDisplay = this.#padValue( progressValue )
        const statusDisplay = this.#padValue( statusValue )

        const progressLine = `│ ${progressLabel} │ ${progressDisplay} │`
        const statusLine = `│ ${statusLabel} │ ${statusDisplay} │`
        const endLine = `└${'─'.repeat( this.#LABEL_WIDTH )}┴${'─'.repeat( this.#VALUE_WIDTH )}┘`

        // Move cursor up 3 lines and overwrite everything in one write
        const output = `\x1b[3A\r\x1b[K${progressLine}\n\r\x1b[K${statusLine}\n\r\x1b[K${endLine}\n`
        process.stdout.write( output )
    }


    static #padValue( value ) {
        const valueStr = String( value )
        const visibleLength = this.#stripAnsi( valueStr ).length
        const maxVisible = this.#VALUE_WIDTH - 2

        let displayValue = valueStr
        if( visibleLength > maxVisible ) {
            const stripped = this.#stripAnsi( valueStr )
            displayValue = stripped.substring( 0, maxVisible - 3 ) + '...'
        }

        const displayVisibleLength = this.#stripAnsi( displayValue ).length
        const paddingNeeded = maxVisible - displayVisibleLength

        return displayValue + ' '.repeat( Math.max( 0, paddingNeeded ) )
    }


    static tableConversionDone( { percentage, tokens, contextWindow, userStories, stateDir } ) {
        // Move cursor up 3 lines
        process.stdout.write( '\x1b[3A' )
        this.#clearLine()
        this.tableRow( { label: 'Progress', value: this.formatProgress( { percentage, tokens, contextWindow } ) } )
        this.#clearLine()
        this.tableRow( { label: 'Status', value: chalk.green( '✓' ) + ' Done' } )
        this.#clearLine()
        this.tableRow( { label: 'User Stories', value: `${userStories} extracted` } )
        this.#clearLine()
        this.tableRow( { label: 'State', value: `saved to ${stateDir}` } )
        this.tableEnd()
    }


    static tableTaskStart( { index, total, taskId, title, repo } ) {
        console.log( '' )
        this.tableStart( { title: `[${index}/${total}] ${taskId}: ${title}` } )
        this.tableRow( { label: 'Repo', value: repo } )
        this.tableRow( { label: 'Progress', value: this.formatProgress( { percentage: 0, tokens: 0, contextWindow: 200000 } ) } )
        this.tableRow( { label: 'Status', value: '⠋ Initializing...' } )
        this.tableEnd()
    }


    static tableTaskUpdate( { percentage, tokens, contextWindow, status, spinnerFrame } ) {
        const frame = spinnerFrame || '⠸'

        // Build all lines first
        const progressValue = this.formatProgress( { percentage, tokens, contextWindow } )
        const statusValue = `${frame} ${status}`

        const progressLabel = 'Progress'.padEnd( this.#LABEL_WIDTH - 2 )
        const statusLabel = 'Status'.padEnd( this.#LABEL_WIDTH - 2 )

        const progressDisplay = this.#padValue( progressValue )
        const statusDisplay = this.#padValue( statusValue )

        const progressLine = `│ ${progressLabel} │ ${progressDisplay} │`
        const statusLine = `│ ${statusLabel} │ ${statusDisplay} │`
        const endLine = `└${'─'.repeat( this.#LABEL_WIDTH )}┴${'─'.repeat( this.#VALUE_WIDTH )}┘`

        // Move cursor up 3 lines and overwrite everything in one write
        const output = `\x1b[3A\r\x1b[K${progressLine}\n\r\x1b[K${statusLine}\n\r\x1b[K${endLine}\n`
        process.stdout.write( output )
    }


    static tableTaskDone( { percentage, tokens, contextWindow, commitHash, changedFiles } ) {
        // Move cursor up 3 lines
        process.stdout.write( '\x1b[3A' )
        this.#clearLine()
        this.tableRow( { label: 'Progress', value: this.formatProgress( { percentage, tokens, contextWindow } ) } )
        this.#clearLine()
        this.tableRow( { label: 'Status', value: chalk.green( '✓' ) + ' Done' } )
        this.#clearLine()

        if( commitHash ) {
            this.tableRow( { label: 'Commit', value: commitHash.substring( 0, 7 ) } )
        }

        if( changedFiles !== undefined ) {
            const filesText = changedFiles === 1 ? '1 file modified' : `${changedFiles} files modified`
            this.tableRow( { label: 'Changes', value: filesText } )
        }

        this.tableEnd()
    }


    static tableTaskFailed( { percentage, tokens, contextWindow, message } ) {
        // Move cursor up 3 lines
        process.stdout.write( '\x1b[3A' )
        this.#clearLine()
        this.tableRow( { label: 'Progress', value: this.formatProgress( { percentage, tokens, contextWindow } ) } )
        this.#clearLine()
        this.tableRow( { label: 'Status', value: chalk.red( '✗' ) + ' Failed' } )
        this.#clearLine()

        if( message ) {
            this.tableRow( { label: 'Error', value: message } )
        }

        this.tableEnd()
    }


    static tableSummary( { tasksCompleted, tasksTotal, totalInputTokens, totalOutputTokens, commits, branch } ) {
        console.log( '' )
        this.tableStart( { title: 'Summary' } )
        this.tableRow( { label: 'Tasks', value: `${tasksCompleted}/${tasksTotal} completed` } )
        this.tableRow( { label: 'Total Tokens', value: `${totalInputTokens.toLocaleString()} input / ${totalOutputTokens.toLocaleString()} output` } )
        this.tableRow( { label: 'Commits', value: String( commits ) } )
        this.tableRow( { label: 'Branch', value: branch } )
        this.tableEnd()
    }


    static tableSummaryComplete( { completed, total, branch } ) {
        console.log( '' )
        this.tableStart( { title: 'Project Complete' } )
        this.tableRow( { label: 'Tasks', value: `${completed}/${total}` } )
        this.tableRow( { label: 'Branch', value: branch } )
        this.tableRow( { label: 'Status', value: chalk.green( '✓ All tasks completed' ) } )
        this.tableEnd()
    }
}


export { Print }
