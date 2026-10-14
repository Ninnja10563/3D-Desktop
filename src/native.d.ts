export {};
declare global {
  interface Window {
    depthNative?: {
      platform: string;
      getApps(): Promise<{id:string;name:string;path:string}[]>;
      openApp(id:string): Promise<unknown>;
      getSources(): Promise<{id:string;name:string;thumbnail:string;appName?:string}[]>;
      selectSource(id:string): Promise<unknown>;
      getScreenPermission(): Promise<string>;
      openScreenPrivacySettings(): Promise<unknown>;
      toggleFullscreen(): Promise<unknown>;
    }
  }
}
