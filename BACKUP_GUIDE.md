# Turing Tasks Backup Guide

To backup nested git repositories (Celery, SWR, MSW, etc.) into the main 'ai-challenges' repo without using submodules:

## The Automatic Way
Run the custom alias:
`turing-backup`

## The Manual Way (if alias is missing)
1. **Hide internal history:**
   `find . -mindepth 2 -name ".git" -type d -exec mv {} {}_hide ;`
2. **Stage files:**
   `git add .`
3. **Restore internal history:**
   `find . -mindepth 2 -name ".git_hide" -type d -exec sh -c 'mv "$1" "${1%_hide}"' _ {} ;`
4. **Push:**
   `git commit -m "Manual update" && git push origin main --force`

*Note: Large files like terminal-bench are ignored via .gitignore to stay under GitHub's 100MB limit.*
