"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

type Deserialize<T> = (raw: string) => T;
type Serialize<T> = (value: T) => string;

interface UsePersistentStateOptions<T> {
  deserialize?: Deserialize<T>;
  serialize?: Serialize<T>;
}

function defaultDeserialize<T>(raw: string, initialValue: T): T {
  if (typeof initialValue === "string") {
    return raw as T;
  }
  return JSON.parse(raw) as T;
}

function defaultSerialize<T>(value: T): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

export function usePersistentState<T>(
  key: string,
  initialValue: T,
  options: UsePersistentStateOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;

    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initialValue;

      const deserialize =
        options.deserialize ??
        ((item: string) => defaultDeserialize(item, initialValue));
      return deserialize(raw);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const serialize = options.serialize ?? defaultSerialize;
      window.localStorage.setItem(key, serialize(value));
    } catch {
      // noop
    }
  }, [key, options.serialize, value]);

  return [value, setValue];
}
