import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  checkedSum,
  inclusiveDates,
  localActivity,
} from "../src/reports/report-policy.js";

describe("report policy", () => {
  it("enumerates month and year boundaries deterministically", () => {
    expect(inclusiveDates("2026-12-31", "2027-01-02")).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("uses the branch IANA timezone for activity date and hour", () => {
    expect(
      localActivity(new Date("2026-08-06T23:30:00.000Z"), "Africa/Accra"),
    ).toEqual({ date: "2026-08-06", hour: "23" });
  });

  it("rejects unsafe JSON totals", () => {
    expect(() => checkedSum([Number.MAX_SAFE_INTEGER, 1])).toThrow(
      ConflictException,
    );
  });
});
