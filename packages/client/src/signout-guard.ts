/**
 * Lets a sign-out win over a sign-in or restore that is still awaiting OpenKey, the node or the backend. Without it the
 * later completion would save the session and receipt again and set the signed-in state, so a reload signs the person
 * back in. `capture` at the start of the flow, then `await superseded()` after every await: when it answers true the
 * flow has already been abandoned (the callback signs out the client it built and clears its saved session and receipt)
 * and must assign nothing and return.
 */
export interface SignOutGuard {
  /** Call from the sign-out. */
  signedOut(): void;
  capture(abandon: () => void | Promise<void>): () => Promise<boolean>;
}

export function createSignOutGuard(): SignOutGuard {
  let generation = 0;
  return {
    signedOut() {
      generation++;
    },
    capture(abandon) {
      const at = generation;
      return async () => {
        if (generation === at) return false;
        await abandon();
        return true;
      };
    },
  };
}
