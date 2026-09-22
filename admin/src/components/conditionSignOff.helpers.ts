/**
 * components/conditionSignOff.helpers.ts
 * ---------------------------------------------------------------------------
 * The state and payload shape for the customer's condition sign-off.
 *
 * In its own file so `ConditionSignOff.tsx` exports only a component - Fast
 * Refresh cannot hot-reload a module that mixes the two, and the handover form
 * is exactly the screen where losing your typed-in state on every save hurts.
 */
export interface SignOffState {
  customerSignedName: string;
  customerDeclined: boolean;
}

export function emptySignOff(): SignOffState {
  return { customerSignedName: '', customerDeclined: false };
}

/** The two fields, in the shape the API expects. */
export function signOffPayload(state: SignOffState) {
  return {
    customerSignedName: state.customerDeclined
      ? undefined
      : state.customerSignedName.trim() || undefined,
    customerDeclined: state.customerDeclined,
  };
}
