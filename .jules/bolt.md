## 2024-05-24 - Eliminate Array.shift() O(N^2) Overhead in BFS Queues
**Learning:** Using `Array.shift()` to dequeue items in Breadth-First Search (BFS) loops introduces an $O(N^2)$ complexity due to array re-indexing on every shift. This is a common performance anti-pattern in graph traversal code.
**Action:** Replace `const item = queue.shift()` with an index pointer: `let queueIndex = 0; while (queueIndex < queue.length) { const item = queue[queueIndex++]; }`. This reduces queue operations to $O(1)$ and speeds up graph analysis in ComfyUI workflows and cache eviction routines.
## 2026-05-17 - Eliminate Array.map() O(N) Allocation Overhead for new Set()
**Learning:** Initializing a `Set` with a mapped array, such as `new Set(images.map(img => img.id))`, creates an unnecessary intermediate array of strings that immediately gets garbage collected. This increases memory usage and GC pauses.
**Action:** Replace `new Set(array.map(item => item.prop))` with an explicit `for` loop that iterates over the original array and adds elements directly to the `Set`. This avoids the temporary array allocation and speeds up data operations.
