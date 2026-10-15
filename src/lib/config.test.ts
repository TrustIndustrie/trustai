import { afterEach, describe, expect, it } from "vitest";
import { getAppMode, isSupabaseConfigured } from "./config";

const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.anon;
});

describe("Modes de l'application", () => {
  it("sans variables Supabase : mode démonstration", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(isSupabaseConfigured()).toBe(false);
    expect(getAppMode()).toBe("demo");
  });

  it("avec les deux variables publiques : mode connecté", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemple.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_exemple";
    expect(isSupabaseConfigured()).toBe(true);
    expect(getAppMode()).toBe("connected");
  });

  it("une seule variable ne suffit pas", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemple.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(getAppMode()).toBe("demo");
  });
});
