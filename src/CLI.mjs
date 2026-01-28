import chalk from 'chalk'
import figlet from 'figlet'
import inquirer from 'inquirer'
import fs from 'fs/promises'
import path from 'path'

import { config } from './data/config.mjs'
import { RalphLoop, EXIT_CODES } from './task/RalphLoop.mjs'
import { UserConfig } from './utils/UserConfig.mjs'


class CLI {
    #state
    #config


    constructor() {
        this.#config = config
        this.#state = {}

        // Handle Ctrl+C gracefully
        process.on( 'SIGINT', () => {
            console.log( '\n' )
            console.log( chalk.yellow( 'Aborted.' ) )
            process.exit( 0 )
        } )
    }


    async start() {
        this.#addHeadline()

        // 1. Config Folder (with default)
        this.#state[ 'configPath' ] = await this.#setConfigPath()

        // 2. Ensure ~/.ralph/ exists, init if needed
        const { created } = await UserConfig.ensureDir( { configPath: this.#state[ 'configPath' ] } )
        if( created ) {
            console.log( '' )
        }

        // 3. PRD Folder (with default)
        this.#state[ 'prdFolder' ] = await this.#setPrdFolder()

        // 4. PRD Files Selection
        const { prdItems, folderExists } = await this.#findPrdFilesWithStatus( { prdFolder: this.#state[ 'prdFolder' ] } )
        const { selectedPrds } = await this.#selectPrdFiles( { prdItems, folderExists, prdFolder: this.#state[ 'prdFolder' ] } )

        // 5. Skill Selection (Template Set)
        this.#state[ 'templateSet' ] = await this.#setTemplateSet()

        if( selectedPrds.length === 0 ) {
            console.log( chalk.red( 'No PRD files selected' ) )
            process.exit( EXIT_CODES.FILE_NOT_FOUND )
        }

        // 6. Determine order if multiple PRDs selected
        let orderedPrds = selectedPrds
        if( selectedPrds.length > 1 ) {
            const { orderedPrds: reordered } = await this.#selectOrder( { selectedPrds } )
            orderedPrds = reordered
        }

        // 7. Execute directly (no command menu)
        this.#state[ 'prdPaths' ] = orderedPrds
        const { exitCode } = await this.#executeRun()

        return { exitCode }
    }


    #addHeadline() {
        const { text, params } = this.#config[ 'cli' ][ 'headline' ]

        console.log( chalk.green(
            figlet.textSync( text, params )
        ) )
    }


    async #findPrdFilesWithStatus( { prdFolder } ) {
        const prdDir = prdFolder

        // Check if folder exists
        try {
            await fs.access( prdDir )
        } catch {
            return { prdItems: [], folderExists: false }
        }

        const entries = await fs.readdir( prdDir, { withFileTypes: true } )

        // Filter for .ralph files (new naming convention)
        const prdFiles = entries
            .filter( ( entry ) => entry.isFile() && entry.name.endsWith( '.ralph' ) )
            .map( ( entry ) => path.join( prdDir, entry.name ) )

        // Scan children folders in work directories
        const childrenPromises = prdFiles
            .map( async ( prdFile ) => {
                const { ralphDir } = RalphLoop.getRalphDir( { prdPath: prdFile } )
                const childrenDir = path.join( ralphDir, 'children' )

                try {
                    await fs.access( childrenDir )
                    const childEntries = await fs.readdir( childrenDir, { withFileTypes: true } )

                    return childEntries
                        .filter( ( e ) => e.isFile() && e.name.endsWith( '.ralph' ) )
                        .map( ( e ) => ( {
                            prdPath: path.join( childrenDir, e.name ),
                            isChild: true,
                            parentPrd: prdFile
                        } ) )
                } catch {
                    return []
                }
            } )

        const childrenArrays = await Promise.all( childrenPromises )

        // Build a map of parent -> children for hierarchical ordering
        const childrenByParent = new Map()
        prdFiles
            .forEach( ( prdFile, idx ) => {
                childrenByParent.set( prdFile, childrenArrays[ idx ] || [] )
            } )

        // Interleave: parent followed by its children
        const allPrdFiles = []
        prdFiles
            .forEach( ( prdFile ) => {
                allPrdFiles.push( { prdPath: prdFile, isChild: false, parentPrd: null } )
                const children = childrenByParent.get( prdFile ) || []
                children
                    .forEach( ( child ) => {
                        allPrdFiles.push( child )
                    } )
            } )

        // Get status for each PRD file
        const statusPromises = allPrdFiles
            .map( async ( { prdPath, isChild, parentPrd } ) => {
                const displayName = path.basename( prdPath )
                const { status, statusLabel, completedCount, totalCount } = await this.#getPrdStatus( { prdFile: prdPath } )

                return { prdFile: prdPath, displayName, status, statusLabel, completedCount, totalCount, isChild, parentPrd }
            } )

        const prdStatuses = await Promise.all( statusPromises )

        // Build display items with status labels and hierarchy
        const prdItems = prdStatuses
            .map( ( { prdFile, displayName, status, statusLabel, completedCount, totalCount, isChild } ) => {
                const progressInfo = totalCount > 0 ? ` ${completedCount}/${totalCount}` : ''
                const label = this.#formatStatusLabel( { status, statusLabel, progressInfo } )
                const prefix = isChild ? '  └─ ' : ''
                const paddedName = ( prefix + displayName ).padEnd( 34 )
                const shortLabel = `[${statusLabel}${progressInfo}]`

                return {
                    name: `${paddedName} ${label}`,
                    value: prdFile,
                    short: `${displayName} ${shortLabel}`
                }
            } )

        return { prdItems, folderExists: true }
    }


    async #getPrdStatus( { prdFile } ) {
        // prdFile may already be a full path or relative path
        const prdPath = path.isAbsolute( prdFile ) ? prdFile : path.join( process.cwd(), prdFile )
        const { ralphDir } = RalphLoop.getRalphDir( { prdPath } )
        const progressPath = path.join( ralphDir, 'progress.json' )

        try {
            await fs.access( ralphDir )
        } catch {
            // No .ralph directory = not started
            return { status: null, statusLabel: 'NOT STARTED', completedCount: 0, totalCount: 0 }
        }

        // Read progress.json
        try {
            const progressContent = await fs.readFile( progressPath, 'utf-8' )
            const progress = JSON.parse( progressContent )

            const { status, completedTasks, totalTasks } = progress
            const completedCount = completedTasks?.length || 0
            const totalCount = totalTasks || 0

            // Map status to display label
            const statusMap = {
                'initialized': 'READY',
                'running': 'IN PROGRESS',
                'paused': 'PAUSED',
                'blocked': 'BLOCKED',
                'completed': 'COMPLETED'
            }

            const statusLabel = statusMap[ status ] || status?.toUpperCase() || 'UNKNOWN'

            return { status, statusLabel, completedCount, totalCount }
        } catch {
            // progress.json doesn't exist or is invalid = ready to start
            return { status: 'initialized', statusLabel: 'READY', completedCount: 0, totalCount: 0 }
        }
    }


    #formatStatusLabel( { status, statusLabel, progressInfo } ) {
        const colorMap = {
            'NOT STARTED': chalk.blue,
            'READY': chalk.green,
            'IN PROGRESS': chalk.yellow,
            'PAUSED': chalk.yellow,
            'BLOCKED': chalk.red,
            'COMPLETED': chalk.gray
        }

        const colorFn = colorMap[ statusLabel ] || chalk.white
        const labelText = `[${statusLabel}${progressInfo}]`

        return colorFn( labelText )
    }


    async #setConfigPath() {
        const { ralphDir: defaultPath } = UserConfig.getRalphDir()

        const { configPath } = await inquirer.prompt( [
            {
                type: 'input',
                name: 'configPath',
                message: 'Config folder:',
                default: defaultPath
            }
        ] )

        return configPath
    }


    async #setPrdFolder() {
        const defaultPrdFolder = '.ralph'

        const { prdFolder } = await inquirer.prompt( [
            {
                type: 'input',
                name: 'prdFolder',
                message: 'PRD folder:',
                default: defaultPrdFolder
            }
        ] )

        // Resolve relative paths to absolute
        const resolvedFolder = path.resolve( prdFolder )

        return resolvedFolder
    }


    async #setTemplateSet() {
        const { sets } = await UserConfig.listSets( { configPath: this.#state[ 'configPath' ] } )
        const { config: userConfig } = await UserConfig.loadConfig( { configPath: this.#state[ 'configPath' ] } )

        const { templateSet } = await inquirer.prompt( [
            {
                type: 'list',
                name: 'templateSet',
                message: 'Skill:',
                choices: sets,
                default: userConfig[ 'defaultSet' ] || 'default'
            }
        ] )

        return templateSet
    }


    async #selectPrdFiles( { prdItems, folderExists, prdFolder } ) {
        // Add custom path option
        const customPathOption = {
            name: chalk.cyan( '→ Custom path...' ),
            value: '__CUSTOM_PATH__',
            short: 'Custom path'
        }

        // Determine message and choices based on folder state
        let message
        let choices

        if( !folderExists ) {
            console.log( chalk.yellow( `Folder does not exist: ${prdFolder}` ) )
            message = 'Enter custom path:'
            choices = [ customPathOption ]
        } else if( prdItems.length === 0 ) {
            message = 'No PRD files found. Enter custom path:'
            choices = [ customPathOption ]
        } else {
            message = 'Select PRD files:'
            choices = [ ...prdItems, new inquirer.Separator(), customPathOption ]
        }

        const { selectedPrds } = await inquirer.prompt( [
            {
                type: 'checkbox',
                name: 'selectedPrds',
                message,
                choices,
                validate: ( answer ) => {
                    if( answer.length === 0 ) {
                        return 'Please select at least one PRD'
                    }

                    return true
                }
            }
        ] )

        // Check if custom path was selected
        const hasCustomPath = selectedPrds.includes( '__CUSTOM_PATH__' )
        let finalPrds = selectedPrds.filter( ( p ) => p !== '__CUSTOM_PATH__' )

        if( hasCustomPath ) {
            const { customPath } = await inquirer.prompt( [
                {
                    type: 'input',
                    name: 'customPath',
                    message: 'Enter PRD path (relative or absolute):',
                    validate: async ( input ) => {
                        if( !input.trim() ) {
                            return 'Please enter a path'
                        }

                        // Check if file exists
                        const resolvedPath = path.resolve( input.trim() )
                        try {
                            await fs.access( resolvedPath )

                            return true
                        } catch {
                            return `File not found: ${resolvedPath}`
                        }
                    }
                }
            ] )

            finalPrds.push( customPath.trim() )
        }

        return { selectedPrds: finalPrds }
    }


    async #selectOrder( { selectedPrds } ) {
        console.log( '' )
        console.log( chalk.cyan( 'Selected PRDs:' ) )

        selectedPrds
            .forEach( ( prd, idx ) => {
                console.log( `  ${idx + 1}. ${prd}` )
            } )

        console.log( '' )

        const { orderInput } = await inquirer.prompt( [
            {
                type: 'input',
                name: 'orderInput',
                message: `Enter execution order (e.g. "${selectedPrds.map( ( _, i ) => i + 1 ).join( ',' )}"):`,
                default: selectedPrds.map( ( _, i ) => i + 1 ).join( ',' ),
                validate: ( input ) => {
                    const nums = input.split( ',' ).map( ( n ) => parseInt( n.trim(), 10 ) )

                    // Check all are valid numbers
                    if( nums.some( ( n ) => isNaN( n ) ) ) {
                        return 'Please enter comma-separated numbers'
                    }

                    // Check all are in range
                    if( nums.some( ( n ) => n < 1 || n > selectedPrds.length ) ) {
                        return `Numbers must be between 1 and ${selectedPrds.length}`
                    }

                    // Check no duplicates
                    const uniqueNums = new Set( nums )
                    if( uniqueNums.size !== nums.length ) {
                        return 'Each number can only appear once'
                    }

                    // Check all PRDs are included
                    if( nums.length !== selectedPrds.length ) {
                        return `Please include all ${selectedPrds.length} PRDs`
                    }

                    return true
                }
            }
        ] )

        // Reorder based on input
        const indices = orderInput.split( ',' ).map( ( n ) => parseInt( n.trim(), 10 ) - 1 )
        const orderedPrds = indices.map( ( idx ) => selectedPrds[ idx ] )

        return { orderedPrds }
    }


    async #executeRun() {
        const { prdPaths, configPath, templateSet } = this.#state
        const workingDir = process.cwd()
        const totalPrds = prdPaths.length

        // Execute PRDs sequentially using reduce
        const { results, finalExitCode } = await prdPaths
            .reduce( async ( accPromise, prdPath, idx ) => {
                const acc = await accPromise

                // Skip if already stopped
                if( acc.stopped ) {
                    return acc
                }

                if( totalPrds > 1 ) {
                    console.log( '' )
                    console.log( chalk.cyan( `[${idx + 1}/${totalPrds}] Processing: ${prdPath}` ) )
                    console.log( chalk.cyan( '='.repeat( 50 ) ) )
                }

                const result = await RalphLoop.run( {
                    prdPath,
                    workingDir,
                    dryRun: false,
                    configPath,
                    templateSet
                } )

                acc.results.push( { prdPath, exitCode: result.exitCode } )

                // Track worst exit code
                if( result.exitCode !== EXIT_CODES.SUCCESS ) {
                    acc.finalExitCode = result.exitCode
                    console.log( '' )
                    console.log( chalk.red( `Stopped at PRD ${idx + 1}/${totalPrds} due to failure` ) )
                    acc.stopped = true
                }

                return acc
            }, Promise.resolve( { results: [], finalExitCode: EXIT_CODES.SUCCESS, stopped: false } ) )

        // Summary for multiple PRDs
        if( totalPrds > 1 ) {
            console.log( '' )
            console.log( chalk.cyan( '='.repeat( 50 ) ) )
            console.log( chalk.cyan( 'Summary:' ) )

            results
                .forEach( ( { prdPath, exitCode } ) => {
                    const statusIcon = exitCode === EXIT_CODES.SUCCESS ? chalk.green( 'OK' ) : chalk.red( 'FAIL' )
                    console.log( `  ${statusIcon} ${prdPath}` )
                } )

            // Show remaining if stopped early
            if( results.length < totalPrds ) {
                const remaining = totalPrds - results.length
                console.log( chalk.yellow( `  ... ${remaining} PRD(s) skipped` ) )
            }
        }

        return { exitCode: finalExitCode }
    }
}


export { CLI }
