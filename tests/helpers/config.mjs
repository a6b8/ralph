import fs from 'fs/promises'
import path from 'path'
import os from 'os'


const TEST_CONFIG = {
    testDir: path.join( os.tmpdir(), 'ralph-test-' + Date.now() ),
    validConfigContent: {
        "version": "1.0.0",
        "defaultSet": "prd-executor",
        "cli": {
            "headline": {
                "text": "Ralph",
                "font": "Slant"
            }
        }
    },
    validSetContent: {
        "name": "test-set",
        "description": "Test set",
        "version": "1.0.0",
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
                "skipContext": false
            }
        ]
    },
    invalidSetContent: {
        "name": "invalid-set"
        // Missing required keys: version, conversion, task
    }
}


async function createTestDir( { testDir } ) {
    await fs.mkdir( testDir, { recursive: true } )

    return { testDir }
}


async function cleanupTestDir( { testDir } ) {
    try {
        await fs.rm( testDir, { recursive: true, force: true } )
    } catch {
        // Ignore cleanup errors
    }

    return { cleaned: true }
}


async function createValidConfig( { testDir } ) {
    const configPath = path.join( testDir, 'config.json' )
    await fs.writeFile( configPath, JSON.stringify( TEST_CONFIG.validConfigContent, null, 4 ), 'utf-8' )

    return { configPath }
}


async function createValidSetConfig( { testDir, setName = 'test-set' } ) {
    const setsDir = path.join( testDir, 'sets', setName )
    await fs.mkdir( setsDir, { recursive: true } )

    const setJsonPath = path.join( setsDir, 'set.json' )
    await fs.writeFile( setJsonPath, JSON.stringify( TEST_CONFIG.validSetContent, null, 4 ), 'utf-8' )

    return { setJsonPath, setsDir }
}


async function createInvalidSetConfig( { testDir, setName = 'invalid-set' } ) {
    const setsDir = path.join( testDir, 'sets', setName )
    await fs.mkdir( setsDir, { recursive: true } )

    const setJsonPath = path.join( setsDir, 'set.json' )
    await fs.writeFile( setJsonPath, JSON.stringify( TEST_CONFIG.invalidSetContent, null, 4 ), 'utf-8' )

    return { setJsonPath, setsDir }
}


async function createCorruptedJson( { testDir, filename = 'config.json' } ) {
    const filePath = path.join( testDir, filename )
    await fs.writeFile( filePath, 'this is not valid json {{{', 'utf-8' )

    return { filePath }
}


async function createTemplate( { testDir, setName, templateName } ) {
    const templateDir = path.join( testDir, 'sets', setName )
    await fs.mkdir( templateDir, { recursive: true } )

    const templatePath = path.join( templateDir, `${templateName}.prompt.md` )
    await fs.writeFile( templatePath, '# Test Template\n\nContent here.', 'utf-8' )

    return { templatePath }
}


export {
    TEST_CONFIG,
    createTestDir,
    cleanupTestDir,
    createValidConfig,
    createValidSetConfig,
    createInvalidSetConfig,
    createCorruptedJson,
    createTemplate
}
