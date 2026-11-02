import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "../i18n";

import { HeaderAccountMenu } from "./HeaderAccountMenu";

function renderMenu(onSignOut = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<><nav aria-label="Primary"><div className="media-nav-icons"><HeaderAccountMenu username="Frederik Emmer" owner kind="account" onSignOut={onSignOut} /></div></nav><button type="button">Outside</button></>} />
        <Route path="/settings" element={<p>Settings page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HeaderAccountMenu", () => {
  afterEach(() => cleanup());

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows the owner identity and account link, and closes with Escape", async () => {
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Account menu for Frederik Emmer" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const menu = await screen.findByRole("menu", { name: "My account" });
    expect(screen.getByText("Frederik Emmer")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "My account" })).toHaveAttribute("href", "/settings?section=accounts&account=me");
    expect(screen.getByRole("menuitem", { name: "My account" })).toHaveFocus();

    fireEvent.keyDown(menu, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("signs out from the menu and closes when the user clicks outside", async () => {
    const onSignOut = vi.fn();
    renderMenu(onSignOut);

    const trigger = screen.getByRole("button", { name: "Account menu for Frederik Emmer" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    fireEvent.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});
