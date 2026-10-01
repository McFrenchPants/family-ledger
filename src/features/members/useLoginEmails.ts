import { useCallback, useEffect, useState } from "react";

import { invokeFunction } from "./function-errors";

/**
 * Login emails for a household's members (member id -> email). Non-critical:
 * if the lookup fails the map simply stays empty and the page works without
 * showing emails. The Edge Function re-checks the caller is a Parent.
 */
export function useLoginEmails(householdId: string) {
  const [emails, setEmails] = useState<Record<string, string | null>>({});
  const [token, setToken] = useState(0);

  const refetch = useCallback(() => setToken((value) => value + 1), []);

  useEffect(() => {
    let active = true;

    void invokeFunction<{ emails?: Record<string, string | null> }>("manage-household-member", {
      action: "get_login_emails",
      household_id: householdId,
    }).then((result) => {
      if (active && result.ok && result.data?.emails) {
        setEmails(result.data.emails);
      }
    });

    return () => {
      active = false;
    };
  }, [householdId, token]);

  return { emails, refetch };
}
