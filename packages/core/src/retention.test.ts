import { describe, it, expect } from "vitest";
import { retentionSettingsKey, normalizeRetention, DEFAULT_RETENTION } from "./retention";

describe("retentionSettingsKey", () => {
  it("builds a normalized key", () => {
    expect(retentionSettingsKey()).toBe("retention#default");
    expect(retentionSettingsKey("  ")).toBe("retention#default");
  });
});

describe("normalizeRetention", () => {
  it("defaults to keep-forever + 30d Trash purge", () => {
    expect(normalizeRetention(null)).toEqual(DEFAULT_RETENTION);
    expect(normalizeRetention({})).toEqual({ trashPurgeDays: 30, retentionDays: null });
  });

  it("keeps valid values (floored to whole days)", () => {
    expect(normalizeRetention({ trashPurgeDays: 7, retentionDays: 365 })).toEqual({ trashPurgeDays: 7, retentionDays: 365 });
    expect(normalizeRetention({ trashPurgeDays: 14.9, retentionDays: 90.6 })).toEqual({ trashPurgeDays: 14, retentionDays: 90 });
  });

  it("treats 0/negative/invalid retentionDays as keep-forever (never surprise-deletes)", () => {
    expect(normalizeRetention({ retentionDays: 0 }).retentionDays).toBeNull();
    expect(normalizeRetention({ retentionDays: -5 }).retentionDays).toBeNull();
    expect(normalizeRetention({ retentionDays: "nonsense" as never }).retentionDays).toBeNull();
  });

  it("falls back trashPurgeDays to the default when invalid", () => {
    expect(normalizeRetention({ trashPurgeDays: 0 }).trashPurgeDays).toBe(30);
    expect(normalizeRetention({ trashPurgeDays: -1 }).trashPurgeDays).toBe(30);
  });
});
