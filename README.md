![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

```
     ____        __      __       __
    / __ \____ _/ /___  / /_     / /   ____  ____  ____
   / /_/ / __ `/ / __ \/ __ \   / /   / __ \/ __ \/ __ \
  / _, _/ /_/ / / /_/ / / / /  / /___/ /_/ / /_/ / /_/ /
 /_/ |_|\__,_/_/ .___/_/ /_/  /_____/\____/\____/ .___/
              /_/                              /_/
```

Ralph Loop is a Node.js orchestration tool for autonomous PRD-to-code workflows. It converts Product Requirement Documents (PRDs) into structured JSON, then executes user stories sequentially using Claude Code.

> **Experimental** - Use at your own risk. This project is under active development and APIs may change.

## Quickstart

```bash
git clone https://github.com/a6b8/ralph-loop.git
cd ralph-loop
npm install
npm link

cp -r examples/.ralph ~/.ralph

ralph
```

## Features

- **PRD to JSON conversion** - Automatically converts markdown PRDs into structured task definitions
- **Autonomous task execution** - Executes user stories sequentially with dependency resolution
- **Multi-repo support** - Discovers and works across multiple git repositories
- **Progress tracking** - Saves state to resume interrupted workflows
- **Skill/Template sets** - Customizable prompt templates for different project types
- **Security checks** - Built-in validation and safety constraints

## Table of Contents

- [Quickstart](#quickstart)
- [Features](#features)
- [CLI Usage](#cli-usage)
- [Configuration](#configuration)
- [License](#license)

## CLI Usage

Ralph Loop provides an interactive CLI with prompts for configuration:

```
$ ralph

     ____        __      __       __
    / __ \____ _/ /___  / /_     / /   ____  ____  ____
   / /_/ / __ `/ / __ \/ __ \   / /   / __ \/ __ \/ __ \
  / _, _/ /_/ / / /_/ / / / /  / /___/ /_/ / /_/ / /_/ /
 /_/ |_|\__,_/_/ .___/_/ /_/  /_____/\____/\____/ .___/
              /_/                              /_/

? Config folder: ~/.ralph
? PRD folder: .ralph-prds
? Select PRD files:
  PRD-001-auth.ralph                [NOT STARTED]
  PRD-002-payments.ralph            [IN PROGRESS 2/5]
    └─ PRD-002-refund.ralph         [NOT STARTED]
? Skill: prd-generator
```

### Status Labels

| Label | Description |
|-------|-------------|
| NOT STARTED | No working directory exists |
| READY | Initialized, ready for execution |
| IN PROGRESS | Running, shows progress (x/y) |
| PAUSED | Stopped after error |
| BLOCKED | Dependencies not satisfied |
| COMPLETED | All tasks finished |

## Configuration

Ralph Loop stores configuration and templates in `~/.ralph/`:

```
~/.ralph/
├── config.json              # Default settings
└── sets/                    # Template/Skill sets
    └── prd-generator/       # Default skill set
        ├── set.json             # Tool configuration
        ├── converter.prompt.md  # PRD → JSON conversion
        ├── executor.prompt.md   # Task execution
        └── safety.prompt.md     # Safety constraints
```

### config.json

```json
{
    "version": "1.0.0",
    "defaultSet": "prd-generator",
    "cli": {
        "headline": {
            "text": "Ralph",
            "font": "Slant"
        }
    }
}
```

### Template Sets

Each template set contains prompt templates for different phases:

| Template | Purpose |
|----------|---------|
| set.json | Tool configuration and output schemas |
| converter.prompt.md | Converts PRD markdown to JSON structure |
| executor.prompt.md | Executes individual user stories |
| safety.prompt.md | Safety constraints appended to all prompts |

Create custom skill sets by copying the `prd-generator/` folder and modifying the templates.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
