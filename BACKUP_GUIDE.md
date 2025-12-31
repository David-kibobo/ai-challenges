Step 1: git rm -rf --cached . (To clear the index)

Step 2: find . -mindepth 2 -name ".git" -type d -exec mv {} {}_hide \;

Step 3: git add .

Step 4: find . -mindepth 2 -name ".git_hide" -type d -exec sh -c 'mv "$1" "${1%_hide}"' _ {} \;

Step 5: git commit and git push.