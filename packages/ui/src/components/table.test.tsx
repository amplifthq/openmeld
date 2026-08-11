import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "#components/table";

afterEach(cleanup);

describe("Table", () => {
  it("preserves semantic table markup and the full shared primitive contract", () => {
    render(
      <Table aria-label="Team members">
        <TableCaption>Current organization members</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow index={0}>
            <TableCell>Ada Lovelace</TableCell>
            <TableCell>Admin</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>1 member</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    );

    const table = screen.getByRole("table", { name: "Team members" });
    expect(table.closest('[data-slot="table-container"]')).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(
      within(table).getByText("Current organization members")
    ).toBeTruthy();
    expect(within(table).getByText("1 member")).toBeTruthy();

    const memberRow = screen.getByRole("row", {
      name: "Ada Lovelace Admin",
    });
    expect(memberRow.dataset.proximityIndex).toBe("0");
  });

  it("keeps index optional for existing non-proximity tables", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Existing row</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    expect(screen.getByRole("row").dataset.proximityIndex).toBeUndefined();
  });
});
