import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import {
  AccountsPanel,
  changeScope,
  PersonalAccountPanel,
  RightsTree,
  libraryPermissions,
} from "./AccountsPanel";
import * as authModule from "../lib/auth";
import * as accessApi from "../lib/access-session";
import { emptyPolicy, type Identity } from "../lib/auth";
const actor: Identity = {
  id: "owner",
  kind: "account",
  username: "Owner",
  owner: true,
  revision: 1,
  must_change_password: false,
  policy: emptyPolicy(),
};
const libraries = [
  { id: 1, name: "Movies", actions: libraryPermissions },
  { id: 2, name: "Music", actions: libraryPermissions },
];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});
describe("Account permissions", () => {
  it("keeps library-level transcoding rights compact and points to shared rights in a tooltip", async () => {
    const change = vi.fn();
    render(<RightsTree value={emptyPolicy()} onChange={change} libraries={libraries} actor={actor} />);
    fireEvent.click(screen.getByRole("button", { name: "Libraries & files" }));
    fireEvent.click(screen.getByRole("button", { name: "Movies" }));
    expect(screen.getByRole("heading", { name: "Transcoding" })).toBeInTheDocument();
    expect(screen.queryByText("Transcoding automation")).not.toBeInTheDocument();
    const transcodingHelp = screen.getByRole("button", {
      name: "Explain transcoding permissions",
    });
    expect(transcodingHelp).toHaveClass("access-permission-tooltip");
    expect(screen.queryByText(/Shared rights for presets and automation/)).not.toBeInTheDocument();
    fireEvent.click(transcodingHelp);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/Presets & Profiles/);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/app-settings permissions are in Settings/);
    expect(screen.queryByRole("checkbox", { name: /automation/i })).not.toBeInTheDocument();
    fireEvent.click(transcodingHelp);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "automation" } });
    expect(screen.getByRole("button", { name: "Movies" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Music" })).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    expect(libraryPermissions.some(right => right.includes("automation"))).toBe(false);
  });
  it("shows the installation-wide operational scope in a tooltip on its permission", async () => {
    render(<RightsTree value={emptyPolicy()} onChange={() => {}} libraries={libraries} actor={actor} />);
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByText(/View global app settings includes/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain global app settings scope" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/including aggregates from libraries without individual access/);
    expect(screen.getByLabelText("View app settings")).not.toBeChecked();
  });
  it("explains library scope and shared guest job ownership in the Library access tooltip", async () => {
    const props = { value: emptyPolicy(), onChange: () => {}, libraries, actor };
    const { rerender } = render(<RightsTree {...props} guest />);
    fireEvent.click(screen.getByRole("button", { name: "Libraries & files" }));
    expect(screen.queryByText(/Shared scopes start with the intersection/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain library access scope" }));
    const guestTooltip = await screen.findByRole("tooltip");
    expect(guestTooltip).toHaveTextContent(/Shared scopes start with the intersection/);
    expect(guestTooltip).toHaveTextContent(/Guest jobs belong to the shared guest profile/);
    rerender(<RightsTree {...props} />);
    expect(screen.queryByText(/Guest jobs belong to the shared guest profile/)).not.toBeInTheDocument();
  });
  it("shows external catalog scope in a tooltip without changing local or playback rights", async () => {
    render(
      <RightsTree
        value={emptyPolicy()}
        onChange={() => {}}
        libraries={libraries}
        actor={actor}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Connectors" }));
    expect(screen.queryByText(/View connectors includes all external catalog titles and paths/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain external connector catalog access" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/all external catalog titles and paths/);
    expect(screen.getByLabelText("View connectors")).not.toBeChecked();
    expect(screen.getByLabelText("View playback data")).not.toBeChecked();
  });
  it("shows library creation requirements from a tooltip beside the permission", async () => {
    render(<RightsTree value={emptyPolicy()} onChange={() => {}} libraries={libraries} actor={actor} />);
    fireEvent.click(screen.getByRole("button", { name: "Libraries & files" }));
    expect(screen.queryByText(/Creating libraries requires future scope/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain library creation requirements" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/future scope, metadata reading, library editing and path management/);
  });
  it("takes the intersection when changing scope and never enables create implicitly", () => {
    const initial = {
      ...emptyPolicy(),
      libraries: {
        "1": ["library.read", "library.scan"],
        "2": ["library.read"],
      },
    };
    expect(changeScope(initial, "all", libraries).shared).toEqual([
      "library.read",
    ]);
    expect(changeScope(initial, "future", libraries).create).toBe(false);
    expect(
      changeScope(
        {
          ...emptyPolicy(),
          mode: "future",
          shared: ["library.read"],
          create: true,
        },
        "per_library",
        libraries,
      ),
    ).toMatchObject({
      mode: "per_library",
      create: false,
      shared: [],
      libraries: { "1": ["library.read"], "2": ["library.read"] },
    });
    expect(changeScope(initial, "future", []).shared).toEqual([]);
    expect(
      changeScope(
        {
          ...emptyPolicy(),
          mode: "all",
          shared: ["library.read"],
          libraries: { "1": ["library.read"] },
        },
        "future",
        libraries,
      ).shared,
    ).toEqual([]);
  });
  it("retains library parents for permission search and disables bulk editing during search", () => {
    render(
      <RightsTree
        value={emptyPolicy()}
        onChange={() => {}}
        libraries={libraries}
        actor={actor}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Download" },
    });
    expect(screen.getByText("Movies")).toBeInTheDocument();
    expect(screen.getByText("Music")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Download")).toHaveLength(2);
    expect(screen.getByLabelText("Select group: Movies")).toBeDisabled();
    expect(screen.getByLabelText("Select group: Music")).toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.queryByLabelText("Download")).not.toBeInTheDocument();
  });
  it("starts every rights group collapsed and expands only on request", () => {
    render(
      <RightsTree
        value={emptyPolicy()}
        onChange={() => {}}
        libraries={libraries}
        actor={actor}
      />,
    );
    const groupToggles = screen.getAllByRole("button").filter((button) =>
      button.hasAttribute("aria-expanded"),
    );
    expect(groupToggles.length).toBeGreaterThan(1);
    expect(groupToggles.every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(screen.queryByLabelText("Dashboard")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByLabelText("Dashboard")).toBeInTheDocument();
  });
  it("expands a user inline, hides the picker and keeps guest last without a subtitle", () => {
    render(
      <AccountsPanel
        fixture={{
          actor,
          libraries,
          accounts: [
            {
              id: "a",
              username: "Alex",
              owner: false,
              active: true,
              editable: true,
              policy: emptyPolicy(),
              must_change_password: true,
            },
          ],
        }}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByRole("article")[1]).toHaveTextContent("Guest");
    expect(screen.queryByLabelText("Active: Alex")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Guest")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Alex/ }));
    expect(screen.getByLabelText("Active: Alex")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Alex" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Users & access" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Search accounts"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search permissions" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(screen.getByPlaceholderText("Search accounts")).toBeInTheDocument();
    expect(screen.queryByLabelText("Active: Alex")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guest" }));
    expect(screen.getByLabelText("Active: Guest")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Users & access" }),
    ).not.toBeInTheDocument();
  });
  it("shows the owner as read only without editing or save controls", async () => {
    render(
      <AccountsPanel
        fixture={{
          actor,
          libraries,
          accounts: [{ ...actor, active: true, editable: false }],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Owner/ }));
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(
      screen.getByText(/The single owner has immutable full access/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search permissions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Account editor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Account" }),
    ).not.toBeInTheDocument();
    for (const name of ["Save", "Cancel", "Delete"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Active: Owner")).not.toBeInTheDocument();
    for (const group of [
      "Overview",
      "Settings",
      "Connectors",
      "Presets & Profiles",
      "Users & access",
    ]) {
      const toggle = screen.getByLabelText(`Select group: ${group}`);
      expect(toggle).toBeChecked();
      expect(toggle).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByLabelText("Dashboard")).toBeChecked();
    expect(screen.getByLabelText("Dashboard")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByText(/View global app settings includes/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Explain global app settings scope: This permission cannot be delegated/,
      }),
    );
    const lockedPermissionTooltip = await screen.findByRole("tooltip");
    expect(lockedPermissionTooltip).toHaveTextContent(/installation-wide performance data/);
    expect(lockedPermissionTooltip).toHaveTextContent(/This permission cannot be delegated/);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByPlaceholderText("Search accounts")).toBeInTheDocument();
  });
  it("pairs owner username and masked current password with Save and Sign out", () => {
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      identity: { ...actor, username: "Self" },
      status: null,
      has: () => false,
      refresh: vi.fn(),
      logout: vi.fn(),
    });
    const request = vi.spyOn(accessApi, "accessRequest");
    const { container } = render(<PersonalAccountPanel />);
    expect(screen.getByLabelText("Color theme")).toBeInTheDocument();
    expect(screen.getByLabelText("Interface language")).toBeInTheDocument();
    expect(container.querySelectorAll(".personal-account-credentials-grid > label")).toHaveLength(2);
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();

    const currentPassword = screen.getByLabelText("Current password");
    expect(currentPassword).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(currentPassword).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps password changing available to non-owner account holders", () => {
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      identity: { ...actor, owner: false, username: "Alex" },
      status: null,
      has: () => false,
      refresh: vi.fn(),
      logout: vi.fn(),
    });
    const request = vi.spyOn(accessApi, "accessRequest");
    render(<PersonalAccountPanel />);
    expect(screen.getByLabelText("Current password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
  it("returns to the account overview when the active Users & access navigation is selected again", () => {
    const fixture = {
      actor,
      libraries,
      accounts: [
        {
          id: "a",
          username: "Alex",
          owner: false,
          active: true,
          editable: true,
          policy: emptyPolicy(),
          must_change_password: false,
        },
      ],
    };
    const { rerender } = render(<AccountsPanel fixture={fixture} overviewResetKey={0} />);
    fireEvent.click(screen.getByRole("button", { name: /Alex/ }));
    expect(screen.getByLabelText("Active: Alex")).toBeInTheDocument();

    rerender(<AccountsPanel fixture={fixture} overviewResetKey={1} />);

    expect(screen.getByPlaceholderText("Search accounts")).toBeInTheDocument();
    expect(screen.queryByLabelText("Active: Alex")).not.toBeInTheDocument();
  });
  it("renders unavailable permissions disabled and explains them", () => {
    const limited = {
      ...actor,
      owner: false,
      policy: { ...emptyPolicy(), global: ["overview.dashboard"] },
    };
    render(
      <RightsTree
        value={emptyPolicy()}
        onChange={() => {}}
        libraries={libraries}
        actor={limited}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByLabelText("File comparison")).toBeDisabled();
    expect(
      screen.getByLabelText(/File comparison: This permission/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Dashboard")).not.toBeDisabled();
  });
});
