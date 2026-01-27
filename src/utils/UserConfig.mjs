import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { Print } from './Print.mjs'
import { ToolRegistry, ClaudeTool } from '../tools/index.mjs'


class UserConfig {
    static #defaultSetContent = {
        "name": "prd-generator",
        "description": "Ralph templates for generating PRDs from Meta-PRD",
        "version": "1.0.0",
        "systemPrompt": "system.prompt.md",
        "conversion": [
            {
                "tool": "claude",
                "options": {
                    "dangerouslySkipPermissions": true,
                    "verbose": true,
                    "outputFormat": "stream-json"
                },
                "outputSchema": {
                    "type": "object",
                    "required": [ "id", "title", "userStories", "targetDirs", "branchName" ],
                    "properties": {
                        "id": { "type": "string" },
                        "title": { "type": "string" },
                        "branchName": { "type": "string" },
                        "targetDirs": { "type": "array" },
                        "userStories": { "type": "array", "minItems": 1 }
                    }
                }
            }
        ],
        "task": [
            {
                "tool": "claude",
                "options": {
                    "dangerouslySkipPermissions": true,
                    "verbose": true,
                    "outputFormat": "stream-json"
                },
                "skipContext": false,
                "outputSchema": {
                    "type": "object",
                    "required": [ "id", "status", "passes", "securityCheck" ],
                    "properties": {
                        "id": { "type": "string" },
                        "status": { "type": "string", "enum": [ "completed", "failed", "blocked", "pending" ] },
                        "passes": { "type": "boolean" },
                        "securityCheck": { "type": "object" },
                        "commits": { "type": "array" },
                        "changedFiles": { "type": "array" },
                        "generatedPrds": { "type": "array" }
                    }
                }
            }
        ]
    }


    static getRalphDir() {
        const homeDir = os.homedir()
        const ralphDir = path.join( homeDir, '.ralph' )

        return { ralphDir }
    }


    static async ensureDir( { configPath = null } = {} ) {
        const { ralphDir } = configPath
            ? { ralphDir: configPath }
            : this.getRalphDir()

        // Check if directory exists
        try {
            await fs.access( ralphDir )

            return { created: false, ralphDir }
        } catch ( err ) {
            if( err.code === 'ENOENT' ) {
                throw new Error(
                    `Ralph config directory not found: ${ralphDir}\n` +
                    `Copy examples/.ralph/ to ~/.ralph/`
                )
            }

            throw new Error(
                `Cannot access Ralph config directory: ${ralphDir}\n` +
                `Error: ${err.message}`
            )
        }
    }


    static async listSets( { configPath = null } = {} ) {
        const { ralphDir } = configPath
            ? { ralphDir: configPath }
            : this.getRalphDir()

        const setsDir = path.join( ralphDir, 'sets' )

        try {
            const entries = await fs.readdir( setsDir, { withFileTypes: true } )

            const sets = entries
                .filter( ( entry ) => entry.isDirectory() )
                .map( ( entry ) => entry.name )

            return { sets }
        } catch ( err ) {
            throw new Error(
                `Sets directory not found: ${setsDir}\n` +
                `Error: ${err.message}\n` +
                `Copy examples/.ralph/ to ~/.ralph/`
            )
        }
    }


    static getTemplatePath( { configPath = null, setName, templateName } = {} ) {
        const { ralphDir } = configPath
            ? { ralphDir: configPath }
            : this.getRalphDir()

        const templatePath = path.join(
            ralphDir,
            'sets',
            setName,
            `${templateName}.prompt.md`
        )

        return { templatePath }
    }


    static getSystemPromptPath( { configPath = null, setName, systemPromptFile } = {} ) {
        const { ralphDir } = configPath
            ? { ralphDir: configPath }
            : this.getRalphDir()

        const systemPromptPath = path.join(
            ralphDir,
            'sets',
            setName,
            systemPromptFile
        )

        return { systemPromptPath }
    }


    static async systemPromptExists( { configPath = null, setName, systemPromptFile } = {} ) {
        const { systemPromptPath } = this.getSystemPromptPath( { configPath, setName, systemPromptFile } )

        try {
            await fs.access( systemPromptPath )

            return { exists: true }
        } catch ( err ) {
            if( err.code === 'ENOENT' ) {
                return { exists: false }
            }

            throw new Error(
                `Cannot access system prompt: ${systemPromptPath}\n` +
                `Error: ${err.message}`
            )
        }
    }


    static async loadConfig( { configPath = null } = {} ) {
        const { ralphDir } = configPath
            ? { ralphDir: configPath }
            : this.getRalphDir()

        const configJsonPath = path.join( ralphDir, 'config.json' )

        try {
            const content = await fs.readFile( configJsonPath, 'utf-8' )
            const config = JSON.parse( content )

            return { config }
        } catch ( err ) {
            throw new Error(
                `Config not found or invalid: ${configJsonPath}\n` +
                `Error: ${err.message}\n` +
                `Copy examples/.ralph/ to ~/.ralph/`
            )
        }
    }


    static async loadSetConfig( { configPath = null, setName } = {} ) {
        const { ralphDir } = configPath
            ? { ralphDir: configPath }
            : this.getRalphDir()

        const setJsonPath = path.join( ralphDir, 'sets', setName, 'set.json' )

        try {
            const content = await fs.readFile( setJsonPath, 'utf-8' )
            const rawConfig = JSON.parse( content )

            // Migrate old config structure if needed
            const { setConfig, migrated } = this.#migrateSetConfig( { setConfig: rawConfig } )

            if( migrated ) {
                Print.warning( { message: 'Set config uses old structure. Consider updating set.json.' } )
            }

            // Validate the config
            const { valid, messages } = this.validateSetConfig( { setConfig } )

            if( !valid ) {
                const errorMessages = messages.join( '\n  - ' )
                const expectedStructure = JSON.stringify( this.#defaultSetContent, null, 4 )

                throw new Error(
                    `Set config validation failed: ${setJsonPath}\n` +
                    `Errors:\n  - ${errorMessages}\n` +
                    `Expected structure:\n${expectedStructure}`
                )
            }

            return { setConfig }
        } catch ( err ) {
            const expectedPath = setJsonPath
            const expectedStructure = JSON.stringify( this.#defaultSetContent, null, 4 )

            throw new Error(
                `Set config not found or invalid: ${expectedPath}\n` +
                `Error: ${err.message}\n` +
                `Expected structure:\n${expectedStructure}\n` +
                `Copy examples/.ralph/ to ~/.ralph/`
            )
        }
    }


    static validateSetConfig( { setConfig } ) {
        const messages = []

        // Step 1: Check required top-level keys
        const requiredKeys = [ 'name', 'version', 'conversion', 'task' ]
        requiredKeys
            .forEach( ( key ) => {
                if( setConfig[ key ] === undefined ) {
                    messages.push( `set.json: Missing required key "${key}"` )
                }
            } )

        if( messages.length > 0 ) {
            return { valid: false, messages }
        }

        // Step 2: Check conversion and task are arrays with objects
        const { valid: conversionValid, messages: conversionMessages } = this.#validateConfigArray( {
            array: setConfig.conversion,
            arrayName: 'conversion'
        } )

        const { valid: taskValid, messages: taskMessages } = this.#validateConfigArray( {
            array: setConfig.task,
            arrayName: 'task'
        } )

        messages.push( ...conversionMessages, ...taskMessages )

        if( !conversionValid || !taskValid ) {
            return { valid: false, messages }
        }

        // Step 3: Validate each tool config via ToolRegistry
        const { messages: toolMessages } = this.#validateToolConfigs( { setConfig } )
        messages.push( ...toolMessages )

        const valid = messages.length === 0

        return { valid, messages }
    }


    static #validateConfigArray( { array, arrayName } ) {
        const messages = []

        // Must be an array
        if( !Array.isArray( array ) ) {
            messages.push( `set.json.${arrayName}: Must be an array` )

            return { valid: false, messages }
        }

        // Must not be empty
        if( array.length === 0 ) {
            messages.push( `set.json.${arrayName}: Array must contain at least one tool config` )

            return { valid: false, messages }
        }

        // Each element must be an object with "tool" key
        array
            .forEach( ( item, index ) => {
                if( typeof item !== 'object' || item === null || Array.isArray( item ) ) {
                    messages.push( `set.json.${arrayName}[${index}]: Must be an object` )

                    return
                }

                if( item.tool === undefined ) {
                    messages.push( `set.json.${arrayName}[${index}]: Missing required key "tool"` )
                }
            } )

        const valid = messages.length === 0

        return { valid, messages }
    }


    static #validateToolConfigs( { setConfig } ) {
        const messages = []

        // Validate conversion tool configs
        setConfig.conversion
            .forEach( ( config, index ) => {
                const { valid, messages: toolMessages } = ToolRegistry.validateToolConfig( { config } )

                if( !valid ) {
                    toolMessages
                        .forEach( ( msg ) => {
                            messages.push( `conversion[${index}].${msg}` )
                        } )
                }

                // Validate outputSchema if present
                if( config.outputSchema && config.tool === 'claude' ) {
                    const { valid: schemaValid, messages: schemaMessages } = ClaudeTool.validateOutputSchema( { schema: config.outputSchema } )

                    if( !schemaValid ) {
                        schemaMessages
                            .forEach( ( msg ) => {
                                messages.push( `conversion[${index}].${msg}` )
                            } )
                    }
                }
            } )

        // Validate task tool configs
        setConfig.task
            .forEach( ( config, index ) => {
                const { valid, messages: toolMessages } = ToolRegistry.validateToolConfig( { config } )

                if( !valid ) {
                    toolMessages
                        .forEach( ( msg ) => {
                            messages.push( `task[${index}].${msg}` )
                        } )
                }

                // Additional validation for task-specific fields (skipContext)
                if( config.tool === 'claude' ) {
                    const { valid: skipValid, messages: skipMessages } = ClaudeTool.validateSkipContext( { config } )

                    if( !skipValid ) {
                        skipMessages
                            .forEach( ( msg ) => {
                                messages.push( `task[${index}].${msg}` )
                            } )
                    }

                    // Validate outputSchema if present
                    if( config.outputSchema ) {
                        const { valid: schemaValid, messages: schemaMessages } = ClaudeTool.validateOutputSchema( { schema: config.outputSchema } )

                        if( !schemaValid ) {
                            schemaMessages
                                .forEach( ( msg ) => {
                                    messages.push( `task[${index}].${msg}` )
                                } )
                        }
                    }
                }
            } )

        return { messages }
    }


    static #migrateSetConfig( { setConfig } ) {
        let migrated = false

        // Migration 1: Old structure with options.skipTaskContext (v1.0.0 legacy)
        if( setConfig.options?.skipTaskContext !== undefined && !setConfig.task ) {
            const migratedConfig = {
                ...setConfig,
                "conversion": [
                    {
                        "tool": "claude",
                        "options": {
                            "dangerouslySkipPermissions": true,
                            "verbose": true,
                            "outputFormat": "stream-json"
                        }
                    }
                ],
                "task": [
                    {
                        "tool": "claude",
                        "options": {
                            "dangerouslySkipPermissions": true,
                            "verbose": true,
                            "outputFormat": "stream-json"
                        },
                        "skipContext": setConfig.options.skipTaskContext
                    }
                ]
            }

            return { setConfig: migratedConfig, migrated: true }
        }

        // Migration 2: Single object structure (v1.1.0) to array structure
        if( setConfig.conversion && !Array.isArray( setConfig.conversion ) ) {
            setConfig.conversion = [ setConfig.conversion ]
            migrated = true
        }

        if( setConfig.task && !Array.isArray( setConfig.task ) ) {
            setConfig.task = [ setConfig.task ]
            migrated = true
        }

        return { setConfig, migrated }
    }


    static getToolConfig( { setConfig, phase, toolName = null } ) {
        const phaseConfigs = setConfig[ phase ] || []

        // If no toolName specified, return first config
        if( !toolName ) {
            const config = phaseConfigs[ 0 ] || null

            return { config }
        }

        // Find config by tool name
        const config = phaseConfigs.find( ( c ) => c.tool === toolName ) || null

        return { config }
    }


    static async templateExists( { configPath = null, setName, templateName } = {} ) {
        const { templatePath } = this.getTemplatePath( { configPath, setName, templateName } )

        try {
            await fs.access( templatePath )

            return { exists: true }
        } catch ( err ) {
            // Unterscheide zwischen "nicht existent" und anderen Fehlern
            if( err.code === 'ENOENT' ) {
                return { exists: false }
            }

            throw new Error(
                `Cannot access template: ${templatePath}\n` +
                `Error: ${err.message}`
            )
        }
    }
}


export { UserConfig }
