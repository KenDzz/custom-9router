import { it as baseIt } from "vitest";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workspaces/constants.js";

// Enter ALS when the actual test body runs, including each/only/skip variants.
function scopedTest(test) {
  return new Proxy(test, {
    apply(target, thisArg, args) {
      if (typeof args[1] === "function") {
        const callback = args[1];
        args[1] = async (...values) => {
          const { runWithWorkspace } = await import("@/lib/workspaces/requestContext.js");
          return runWithWorkspace({ workspaceId: DEFAULT_WORKSPACE_ID }, () => callback(...values));
        };
      }
      return Reflect.apply(target, thisArg, args);
    },
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === "each" || key === "for") return (...cases) => scopedTest(value.apply(target, cases));
      if (["only", "skip", "fails", "concurrent", "sequential"].includes(key)) return scopedTest(value);
      return value;
    },
  });
}
export const workspaceTest = scopedTest(baseIt);
