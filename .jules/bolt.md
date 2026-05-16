## 2024-05-24 - Eliminate Array.shift() O(N^2) Overhead in BFS Queues
**Learning:** Using `Array.shift()` to dequeue items in Breadth-First Search (BFS) loops introduces an $O(N^2)$ complexity due to array re-indexing on every shift. This is a common performance anti-pattern in graph traversal code.
**Action:** Replace `const item = queue.shift()` with an index pointer: `let queueIndex = 0; while (queueIndex < queue.length) { const item = queue[queueIndex++]; }`. This reduces queue operations to $O(1)$ and speeds up graph analysis in ComfyUI workflows and cache eviction routines.

## 2024-05-24 - Eliminate Array mapping overhead for Set creation
**Learning:** Using `new Set(array.map(item => item.property))` allocates an intermediate array in memory which causes $O(N)$ allocation and GC overhead, especially harmful when processing thousands of images.
**Action:** Replace map-based Set construction with a `for` loop that calls `Set.add()` directly, eliminating the intermediate array creation.
