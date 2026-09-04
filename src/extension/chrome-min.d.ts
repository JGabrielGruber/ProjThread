declare const chrome: {
  storage: {
    local: {
      get(keys: string[] | string): Promise<Record<string, string | undefined>>;
      set(items: Record<string, string>): Promise<void>;
      remove(keys: string[] | string): Promise<void>;
    };
  };
  permissions: {
    request(opt: { origins?: string[] }): Promise<boolean>;
    contains(opt: { origins?: string[] }): Promise<boolean>;
  };
  tabs: {
    query(query: { active?: boolean; currentWindow?: boolean }): Promise<
      { id?: number; windowId?: number; url?: string; title?: string }[]
    >;
    captureVisibleTab(
      windowId?: number,
      options?: { format?: string },
    ): Promise<string>;
  };
  scripting: {
    executeScript<T>(opt: {
      target: { tabId: number };
      func: () => T;
    }): Promise<{ result?: T }[]>;
  };
};
