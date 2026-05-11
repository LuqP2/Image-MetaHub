## 2023-10-24 - Array spread operator bottleneck
**Learning:** Using the array spread operator (`[...prev, new]`) inside a loop over a large array can cause an $O(N^2)$ performance bottleneck due to repeatedly creating new arrays and copying elements.
**Action:** When building aggregated lists inside a loop, mutate the existing array via `.push()` to maintain $O(1)$ amortized insertion time and overall $O(N)$ loop complexity.
## 2024-05-11 - Mocking window.confirm in Vitest
**Learning:** When tests trigger browser interactions like `window.confirm`, Vitest may hang or fail if they are not properly mocked.
**Action:** Use `vi.spyOn(window, 'confirm').mockReturnValue(true)` to mock the interaction during tests, and ensure you call `mockRestore()` after the assertions to clean up the environment for subsequent tests.
