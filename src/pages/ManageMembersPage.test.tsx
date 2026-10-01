// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManageMembersPage } from "./ManageMembersPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

type QueryResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

/**
 * A minimal chainable stand-in for supabase-js's `PostgrestFilterBuilder`:
 * every filter/order method returns the same object, and it resolves via
 * `.then` the way the real (thenable) builder does when `await`ed. Mirrors
 * `SignInForm.test.tsx`'s `vi.mock("../../lib/supabase", ...)` convention,
 * extended to cover `.from()` chains and `functions.invoke` since this page
 * (unlike SignInForm) reads/writes a table and calls an Edge Function.
 */
function makeSelectBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.returns = vi.fn(() => builder);
  builder.then = (
    resolve: (value: QueryResult<T>) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const membersResult: QueryResult<
  {
    id: string;
    name: string;
    role: string;
    status: string;
    created_at: string;
    archived_at: string | null;
  }[]
> = {
  data: [
    {
      id: "m1",
      name: "Alex",
      role: "parent",
      status: "active",
      created_at: "2026-01-01",
      archived_at: null,
    },
    {
      id: "m2",
      name: "Sam",
      role: "child",
      status: "active",
      created_at: "2026-01-01",
      archived_at: null,
    },
    {
      id: "m3",
      name: "Jamie",
      role: "child",
      status: "archived",
      created_at: "2026-01-01",
      archived_at: "2026-02-01",
    },
  ],
  error: null,
};

const { fromMock, invokeMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: fromMock,
    functions: { invoke: invokeMock },
    rpc: rpcMock,
  },
}));

let tableMock: { select: ReturnType<typeof vi.fn> };

const emailsBody = {
  emails: { m1: "alex@example.com", m2: "sam@example.com", m3: "jamie@example.com" },
};

/** Routes the shared Edge Function mock by `action`, defaulting to success. */
function mockFunctions(overrides: Record<string, unknown> = {}) {
  invokeMock.mockImplementation(
    (name: string, options: { body: { action?: string } }) => {
      const key = name === "add-household-member" ? name : (options.body.action ?? "");
      if (key in overrides) {
        return Promise.resolve(overrides[key]);
      }
      if (key === "get_login_emails") {
        return Promise.resolve({ data: emailsBody, error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    },
  );
}

function httpError(status: number, message: string) {
  return {
    data: null,
    error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: { status, json: () => Promise.resolve({ error: message }) },
    }),
  };
}

function callsFor(action: string) {
  return invokeMock.mock.calls.filter(
    ([name, options]) =>
      name === "manage-household-member" && options.body.action === action,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tableMock = { select: vi.fn(() => makeSelectBuilder(membersResult)) };
  fromMock.mockReturnValue(tableMock);
  rpcMock.mockResolvedValue({ data: {}, error: null });
  mockFunctions();
});

const loadedParent: MembershipState = {
  status: "loaded",
  membership: {
    memberId: "m1",
    householdId: "h1",
    role: "parent",
    name: "Alex",
    status: "active",
  },
};

function renderPage() {
  return render(
    <MembershipContext.Provider value={loadedParent}>
      <ManageMembersPage />
    </MembershipContext.Provider>,
  );
}

describe("ManageMembersPage", () => {
  it("renders the member list with role and status, never relying on color alone", async () => {
    renderPage();

    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("Jamie")).toBeInTheDocument();

    const jamieRow = screen.getByText("Jamie").closest("li")!;
    expect(within(jamieRow).getByText("Archived")).toBeInTheDocument();

    const alexRow = screen.getByText("Alex").closest("li")!;
    expect(within(alexRow).getByText("Active")).toBeInTheDocument();
    expect(within(alexRow).getByText("Parent")).toBeInTheDocument();
  });

  it("shows each member's login email under their name", async () => {
    renderPage();

    expect(await screen.findByText("alex@example.com")).toBeInTheDocument();
    const samRow = screen.getByText("Sam").closest("li")!;
    expect(within(samRow).getByText("sam@example.com")).toBeInTheDocument();
    expect(callsFor("get_login_emails")[0][1]).toEqual({
      body: { action: "get_login_emails", household_id: "h1" },
    });
  });

  it("silently omits emails when the lookup fails, and the page still works", async () => {
    mockFunctions({
      get_login_emails: httpError(500, "something went wrong, please try again"),
    });
    renderPage();

    expect(await screen.findByText("Sam")).toBeInTheDocument();
    await waitFor(() => expect(callsFor("get_login_emails")).toHaveLength(1));
    expect(screen.queryByText(/@example\.com/)).not.toBeInTheDocument();
    // No error banner for a non-critical lookup.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Without a known email there is nothing to change, but links still work.
    const samRow = screen.getByText("Sam").closest("li")!;
    expect(
      within(samRow).queryByRole("button", { name: "Change email" }),
    ).not.toBeInTheDocument();
    expect(
      within(samRow).getByRole("button", { name: "Create set-password link" }),
    ).toBeInTheDocument();
  });

  it("only offers Restore on an archived member", async () => {
    renderPage();

    await screen.findByText("Alex");
    const jamieRow = screen.getByText("Jamie").closest("li")!;

    expect(within(jamieRow).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    for (const name of [
      "Rename",
      "Change role",
      "Change email",
      "Create set-password link",
      "Archive",
    ]) {
      expect(within(jamieRow).queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  describe("adding a member", () => {
    async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
      await screen.findByText("Alex");
      await user.type(screen.getByLabelText("Name"), "Riley");
      await user.selectOptions(screen.getByLabelText("Role"), "child");
      await user.type(screen.getByLabelText("Email"), "riley@example.com");
      await user.click(screen.getByRole("button", { name: "Add member" }));
    }

    it("sends no password and shows the returned set-password link in a dialog", async () => {
      const user = userEvent.setup();
      mockFunctions({
        "add-household-member": {
          data: {
            id: "new-1",
            user_id: "u-1",
            set_password_url:
              "https://app.example/set-password#token_hash=tok&type=recovery",
            expires_in_hours: 24,
          },
          error: null,
        },
      });
      renderPage();

      await fillAndSubmit(user);

      expect(invokeMock).toHaveBeenCalledWith("add-household-member", {
        body: {
          household_id: "h1",
          name: "Riley",
          role: "child",
          email: "riley@example.com",
        },
      });

      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText(
          "Send this link to Riley so they can choose their password.",
        ),
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Set-password link")).toHaveValue(
        "https://app.example/set-password#token_hash=tok&type=recovery",
      );
      expect(screen.queryByText(/initial password/i)).not.toBeInTheDocument();
    });

    it("explains how to recover when the link could not be created", async () => {
      const user = userEvent.setup();
      mockFunctions({
        "add-household-member": {
          data: {
            id: "new-1",
            user_id: "u-1",
            set_password_url: null,
            set_password_link_failed: true,
          },
          error: null,
        },
      });
      renderPage();

      await fillAndSubmit(user);

      expect(
        await screen.findByText(
          /Riley was added, but the link could not be created\. Use "Create set-password link" on their row\./,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows the Edge Function's error message on failure and allows retry", async () => {
      const user = userEvent.setup();
      mockFunctions({
        "add-household-member": {
          data: { error: "only an active Parent of this household may add a member" },
          error: new Error("Edge Function returned a non-2xx status code"),
        },
      });
      renderPage();

      await fillAndSubmit(user);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "only an active Parent of this household may add a member",
      );
      // The form is still present so the Parent can correct and retry --
      // no silent queueing, per ADR-007.
      expect(screen.getByRole("button", { name: "Add member" })).toBeInTheDocument();
    });
  });

  describe("archive and restore", () => {
    it("requires a confirm step, then archives through the function (not a table update)", async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;

      await user.click(within(samRow).getByRole("button", { name: "Archive" }));

      expect(within(samRow).getByText(/Archive this member\?/)).toBeInTheDocument();
      expect(
        within(samRow).getByText(/archived members can be restored/i),
      ).toBeInTheDocument();
      expect(callsFor("archive")).toHaveLength(0);

      await user.click(within(samRow).getByRole("button", { name: "Confirm archive" }));

      await waitFor(() => expect(callsFor("archive")).toHaveLength(1));
      expect(callsFor("archive")[0][1]).toEqual({
        body: { action: "archive", member_id: "m2" },
      });
      // The member list is refreshed afterwards.
      await waitFor(() => expect(tableMock.select).toHaveBeenCalledTimes(2));
    });

    it("maps the last-active-Parent refusal to a friendly message", async () => {
      const user = userEvent.setup();
      mockFunctions({
        archive: httpError(
          409,
          "the household's only active Parent can't be archived; make another person a Parent first",
        ),
      });
      renderPage();

      await screen.findByText("Alex");
      const alexRow = screen.getByText("Alex").closest("li")!;

      await user.click(within(alexRow).getByRole("button", { name: "Archive" }));
      await user.click(within(alexRow).getByRole("button", { name: "Confirm archive" }));

      expect(await within(alexRow).findByRole("alert")).toHaveTextContent(
        "You can't archive the household's only active Parent.",
      );
    });

    it("shows a retryable message for a generic failure, and the button works again", async () => {
      const user = userEvent.setup();
      mockFunctions({
        archive: httpError(500, "something went wrong, please try again"),
      });
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;

      await user.click(within(samRow).getByRole("button", { name: "Archive" }));
      await user.click(within(samRow).getByRole("button", { name: "Confirm archive" }));

      expect(await within(samRow).findByRole("alert")).toHaveTextContent(
        "Something went wrong, please try again.",
      );
      expect(within(samRow).getByRole("button", { name: "Archive" })).toBeEnabled();
    });

    it("restores through the function", async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText("Alex");
      const jamieRow = screen.getByText("Jamie").closest("li")!;
      await user.click(within(jamieRow).getByRole("button", { name: "Restore" }));

      await waitFor(() => expect(callsFor("restore")).toHaveLength(1));
      expect(callsFor("restore")[0][1]).toEqual({
        body: { action: "restore", member_id: "m3" },
      });
    });

    it("says it could not reach the service when the call never arrives", async () => {
      const user = userEvent.setup();
      invokeMock.mockImplementation(
        (_name: string, options: { body: { action?: string } }) =>
          options.body.action === "restore"
            ? Promise.reject(new Error("network down"))
            : Promise.resolve({ data: emailsBody, error: null }),
      );
      renderPage();

      await screen.findByText("Alex");
      const jamieRow = screen.getByText("Jamie").closest("li")!;
      await user.click(within(jamieRow).getByRole("button", { name: "Restore" }));

      expect(await within(jamieRow).findByRole("alert")).toHaveTextContent(
        /could not reach/i,
      );
    });
  });

  describe("changing a role", () => {
    it("confirms with consequences, then calls the role function and refreshes", async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(within(samRow).getByRole("button", { name: "Change role" }));

      expect(within(samRow).getByText(/Make Sam a Parent\?/)).toBeInTheDocument();
      expect(
        within(samRow).getByText(
          /A Parent can manage everyone and record payments; a Child can only add expenses\./,
        ),
      ).toBeInTheDocument();
      expect(rpcMock).not.toHaveBeenCalled();

      await user.click(
        within(samRow).getByRole("button", { name: "Confirm role change" }),
      );

      await waitFor(() =>
        expect(rpcMock).toHaveBeenCalledWith("change_household_member_role", {
          p_member_id: "m2",
          p_new_role: "parent",
        }),
      );
      await waitFor(() => expect(tableMock.select).toHaveBeenCalledTimes(2));
    });

    it("proposes Child for a Parent", async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText("Alex");
      const alexRow = screen.getByText("Alex").closest("li")!;
      await user.click(within(alexRow).getByRole("button", { name: "Change role" }));
      await user.click(
        within(alexRow).getByRole("button", { name: "Confirm role change" }),
      );

      await waitFor(() =>
        expect(rpcMock).toHaveBeenCalledWith("change_household_member_role", {
          p_member_id: "m1",
          p_new_role: "child",
        }),
      );
    });

    it("cancel makes no call", async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(within(samRow).getByRole("button", { name: "Change role" }));
      await user.click(within(samRow).getByRole("button", { name: "Cancel" }));

      expect(rpcMock).not.toHaveBeenCalled();
      expect(within(samRow).queryByText(/Make Sam/)).not.toBeInTheDocument();
    });

    it("explains the last-Parent refusal in plain words", async () => {
      const user = userEvent.setup();
      rpcMock.mockResolvedValue({
        data: null,
        error: {
          code: "P0001",
          message: "cannot archive or demote the household's only active Parent",
        },
      });
      renderPage();

      await screen.findByText("Alex");
      const alexRow = screen.getByText("Alex").closest("li")!;
      await user.click(within(alexRow).getByRole("button", { name: "Change role" }));
      await user.click(
        within(alexRow).getByRole("button", { name: "Confirm role change" }),
      );

      expect(await within(alexRow).findByRole("alert")).toHaveTextContent(
        "You can't demote the household's only active Parent. Make another member a Parent first.",
      );
    });

    it("shows a generic retry message for unexpected errors", async () => {
      const user = userEvent.setup();
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: "XX000", message: "internal detail" },
      });
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(within(samRow).getByRole("button", { name: "Change role" }));
      await user.click(
        within(samRow).getByRole("button", { name: "Confirm role change" }),
      );

      const alert = await within(samRow).findByRole("alert");
      expect(alert).toHaveTextContent("Something went wrong. Please try again.");
      expect(alert).not.toHaveTextContent("internal detail");
    });
  });

  describe("changing a login email", () => {
    it("warns about signing in with the new email, calls the function and refreshes emails", async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText("sam@example.com");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(within(samRow).getByRole("button", { name: "Change email" }));

      expect(
        within(samRow).getByText(/will need to sign in with the new email/i),
      ).toBeInTheDocument();

      await user.type(
        within(samRow).getByLabelText(/New login email for Sam/),
        " sam.new@example.com ",
      );
      await user.click(within(samRow).getByRole("button", { name: "Save email" }));

      await waitFor(() => expect(callsFor("change_email")).toHaveLength(1));
      expect(callsFor("change_email")[0][1]).toEqual({
        body: { action: "change_email", member_id: "m2", email: "sam.new@example.com" },
      });
      expect(await within(samRow).findByRole("status")).toHaveTextContent(
        "Login email changed to sam.new@example.com.",
      );
      await waitFor(() => expect(callsFor("get_login_emails")).toHaveLength(2));
    });

    it("shows a plain refusal for an unusable email and keeps the form open", async () => {
      const user = userEvent.setup();
      mockFunctions({ change_email: httpError(400, "that email can't be used") });
      renderPage();

      await screen.findByText("sam@example.com");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(within(samRow).getByRole("button", { name: "Change email" }));
      await user.type(
        within(samRow).getByLabelText(/New login email for Sam/),
        "taken@example.com",
      );
      await user.click(within(samRow).getByRole("button", { name: "Save email" }));

      expect(await within(samRow).findByRole("alert")).toHaveTextContent(
        "That email can't be used.",
      );
      expect(
        within(samRow).getByLabelText(/New login email for Sam/),
      ).toBeInTheDocument();
    });
  });

  describe("set-password link", () => {
    const url = "https://app.example/set-password#token_hash=secrettoken&type=recovery";

    it("shows the link once in a dialog with notes, and drops it when closed", async () => {
      const user = userEvent.setup();
      mockFunctions({
        create_link: { data: { url, expires_in_hours: 24 }, error: null },
      });
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(
        within(samRow).getByRole("button", { name: "Create set-password link" }),
      );

      expect(callsFor("create_link")[0][1]).toEqual({
        body: { action: "create_link", member_id: "m2" },
      });

      const dialog = await screen.findByRole("dialog", {
        name: /Set-password link for Sam/,
      });
      expect(within(dialog).getByLabelText("Set-password link")).toHaveValue(url);
      expect(within(dialog).getByLabelText("Set-password link")).toHaveAttribute(
        "readonly",
      );
      expect(
        within(dialog).getByText(/valid for 24 hours and works only once/i),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          /Anyone who has this link can set that person's password/,
        ),
      ).toBeInTheDocument();
      expect(within(dialog).getByText(/cancels any older link/i)).toBeInTheDocument();
      expect(dialog.contains(document.activeElement)).toBe(true);

      await user.click(within(dialog).getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain("secrettoken");
    });

    it("copies the link to the clipboard", async () => {
      const user = userEvent.setup();
      mockFunctions({
        create_link: { data: { url, expires_in_hours: 24 }, error: null },
      });
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(
        within(samRow).getByRole("button", { name: "Create set-password link" }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Copy link" }));

      expect(await within(dialog).findByText("Copied.")).toBeInTheDocument();
      expect(await navigator.clipboard.readText()).toBe(url);
    });

    it("falls back to selecting the text when copying is not allowed", async () => {
      const user = userEvent.setup();
      mockFunctions({
        create_link: { data: { url, expires_in_hours: 24 }, error: null },
      });
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(
        within(samRow).getByRole("button", { name: "Create set-password link" }),
      );
      const dialog = await screen.findByRole("dialog");
      const writeText = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockRejectedValue(new Error("denied"));
      await user.click(within(dialog).getByRole("button", { name: "Copy link" }));

      expect(
        await within(dialog).findByText(/Could not copy automatically/),
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Set-password link")).toHaveFocus();
      writeText.mockRestore();
    });

    it("closes on Escape", async () => {
      const user = userEvent.setup();
      mockFunctions({
        create_link: { data: { url, expires_in_hours: 24 }, error: null },
      });
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(
        within(samRow).getByRole("button", { name: "Create set-password link" }),
      );
      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("explains the rate limit", async () => {
      const user = userEvent.setup();
      mockFunctions({
        create_link: httpError(
          429,
          "too many links created recently; please try again later",
        ),
      });
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(
        within(samRow).getByRole("button", { name: "Create set-password link" }),
      );

      expect(await within(samRow).findByRole("alert")).toHaveTextContent(
        /created a lot of links recently/i,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows a generic error when the link cannot be made", async () => {
      const user = userEvent.setup();
      mockFunctions({ create_link: httpError(502, "unable to create the link") });
      renderPage();

      await screen.findByText("Alex");
      const samRow = screen.getByText("Sam").closest("li")!;
      await user.click(
        within(samRow).getByRole("button", { name: "Create set-password link" }),
      );

      expect(await within(samRow).findByRole("alert")).toHaveTextContent(
        "Unable to create the link.",
      );
    });
  });
});
