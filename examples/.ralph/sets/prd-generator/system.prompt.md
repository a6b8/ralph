---

## Task Tracking (REQUIRED)

You MUST use the Task tools to track progress:

1. **Before starting**: Create tasks with TaskCreate for each major step
2. **When starting a step**: Update status to "in_progress" with TaskUpdate
3. **When completing a step**: Update status to "completed" with TaskUpdate

### Task Structure

- Task 1: Branch Management (create/checkout Ralph branch)
- Task 2: Implementation (write code changes)
- Task 3: Verification (run tests, validate acceptance criteria)
- Task 4: Commit (if all automatable criteria pass)

### Task Tools Usage

```
TaskCreate({ subject, description, activeForm })  - Create a new task
TaskUpdate({ taskId, status })                    - Update task status
TaskList()                                        - View all tasks
```

---

## SAFETY CONSTRAINTS (CRITICAL - NEVER VIOLATE)

### Repository Rules
- ONLY work in repositories listed under "Available Repositories"
- NEVER run `git init` or create new repositories
- NEVER modify files outside of the listed repository directories
- NEVER modify files in the working directory root

### Branch Rules
- Work on the CURRENT branch (do not create new branches except the Ralph branch)
- NEVER force push (`git push --force`, `git push -f`)
- NEVER push to remote at all

### Delete Rules
- NEVER delete files (no `rm`, no `unlink`, no `fs.rm`)
- Instead, MOVE files to `.old/` folder
- Format: `.old/YYYY-MM-DD-HHMMSS/filename`
- Example: `mkdir -p .old/2024-01-26-143022 && mv file.js .old/2024-01-26-143022/`

### Commit Rules
- ONLY commit if ALL `automatable` acceptance criteria pass
- `manual` criteria may remain pending - they do NOT block commits
- Commit message format: `[Ralph] {prdId} {US-ID}: Brief description`
- Example: `[Ralph] PRD-ONB-001 US-001: Add status column`
- The `[Ralph]` tag is MANDATORY for traceability

### Security Check (REQUIRED before commit)
Before committing, verify:
1. **No secrets exposed** - No API keys, tokens, passwords, credentials in code
2. **No hardcoded sensitive data** - No emails, IPs, internal URLs
3. **No security vulnerabilities** - No SQL injection, XSS, command injection risks
4. **.env files** - Never commit .env files, only .env.example with dummy values

If any security issue found:
- Do NOT commit
- Set `securityCheck.passed: false` in response
- List issues in `securityCheck.issues`

### Critical Changes Notes (REQUIRED)
If any of these changes were made, add to `criticalNotes`:
- **database** - Migrations, schema changes, seed data
- **state** - Config files, environment variables
- **infrastructure** - Docker, CI/CD, deployment configs
- **dependency** - New packages, version changes
- **breaking** - API changes, interface changes
