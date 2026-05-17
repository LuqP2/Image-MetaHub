const fs = require('fs');

let content = fs.readFileSync('store/useImageStore.ts', 'utf8');

// remove duplicate existingIds blocks that got added due to bad merge conflict
content = content.replace(`

            const existingIds = new Set<string>();
            for (let i = 0; i < state.images.length; i++) {
                existingIds.add(state.images[i].id);
            }
`, '');
content = content.replace(`

            const existingIds = new Set<string>();
            for (let i = 0; i < state.images.length; i++) {
                existingIds.add(state.images[i].id);
            }
`, '');
content = content.replace(`
<<<<<<< HEAD
=======
>>>>>>> origin/main`, '');

fs.writeFileSync('store/useImageStore.ts', content);
