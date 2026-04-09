import { getQuickJS, QuickJSContext, QuickJSRuntime, Scope } from "quickjs-emscripten";
import { SpaceVenturoClient } from "./client.js";
import { FunctionDef } from "./registry.js";

export class SecureSandbox {
  constructor(
    private client: SpaceVenturoClient,
    private registry: FunctionDef[]
  ) {}

  async execute(code: string): Promise<unknown> {
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    const vm = runtime.newContext();

    // Track pending host calls to ensure they are cleaned up before vm.dispose()
    const pendingCalls: Promise<void>[] = [];

    try {
      const result = await Scope.withScopeAsync(async (scope) => {
        // 1. Setup bridge
        const callRegistryHandle = scope.manage(vm.newFunction("__callRegistry", (nameHandle, paramsJsonHandle) => {
          const name = vm.getString(nameHandle);
          const paramsJson = vm.getString(paramsJsonHandle);
          const params = JSON.parse(paramsJson);

          const deferred = vm.newPromise();

          const fn = this.registry.find((f) => f.name === name);
          if (!fn) {
             const errHandle = vm.newString(`Function ${name} not found`);
             deferred.reject(errHandle);
             errHandle.dispose();
             const p = deferred.handle.dup();
             deferred.dispose();
             return p;
          }

          const callPromise = (async () => {
            try {
              const res = await fn.handler(this.client, params);
              const resStr = JSON.stringify(res);
              const resHandle = vm.newString(resStr);
              deferred.resolve(resHandle);
              resHandle.dispose();
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              const errHandle = vm.newString(errMsg);
              deferred.reject(errHandle);
              errHandle.dispose();
            } finally {
              runtime.executePendingJobs();
              deferred.dispose();
            }
          })();

          pendingCalls.push(callPromise);
          return deferred.handle.dup();
        }));

        vm.setProp(vm.global, "__callRegistry", callRegistryHandle);

        // 2. Setup print (for debugging)
        const printHandle = scope.manage(vm.newFunction("print", (...args) => {
          console.error("[Sandbox JS]", ...args.map(h => vm.dump(h)));
        }));
        vm.setProp(vm.global, "print", printHandle);

        // 3. Setup helpers
        const injection = `
          const __makeFn = (name) => {
            return async (params = {}) => {
              const res = await __callRegistry(name, JSON.stringify(params));
              return JSON.parse(res);
            };
          };
          for (const name of ${JSON.stringify(this.registry.map(f => f.name))}) {
            globalThis[name] = __makeFn(name);
          }
        `;
        const injRes = scope.manage(vm.evalCode(injection));
        if (injRes.error) throw new Error(JSON.stringify(vm.dump(injRes.error)));

        // 4. Run user code
        const wrappedCode = `(async () => { ${code} })()`;
        const evalRes = scope.manage(vm.evalCode(wrappedCode));
        if (evalRes.error) throw new Error(JSON.stringify(vm.dump(evalRes.error)));

        // 5. Wait for the result
        const promiseRes = await vm.resolvePromise(evalRes.value);
        if (promiseRes.error) {
          const err = vm.dump(promiseRes.error);
          promiseRes.error.dispose();
          throw new Error(JSON.stringify(err));
        }

        const finalResult = vm.dump(promiseRes.value);
        promiseRes.value.dispose();
        return finalResult;
      });

      // Wait for any remaining host-side cleanup in the registry bridge
      await Promise.all(pendingCalls);
      return result;
    } finally {
      vm.dispose();
      runtime.dispose();
    }
  }
}
