export interface TemplateVariable {
  name: string;
  description?: string;
  default: string;
  required: boolean;
  input?: 'text' | 'number' | 'password' | 'checkbox' | 'select' | 'textarea';
  rules?: string[];
}

export interface TemplateImageOption {
  name: string;
  label?: string;
  image: string;
}

type ModManagerTarget = 'mods' | 'plugins' | 'datapacks' | 'modpacks' | 'addons';

type ModManagerProvider =
  | string
  | {
      id: string;
      label?: string;
      game?: string;
      targets?: ModManagerTarget[];
      curseforge?: {
        gameId?: string | number;
        gameSlug?: string;
        classSlugs?: Partial<Record<ModManagerTarget, string>>;
      };
    };

export interface TemplateFeatures {
  restartOnExit?: boolean;
  maxInstances?: number;
  configFile?: string;
  modManager?: {
    targets?: ModManagerTarget[];
    providers: ModManagerProvider[];
    paths?: Record<string, string>;
  };
  pluginManager?: {
    providers: string[];
    paths?: Record<string, string>;
  };
  backupPaths?: string[];
  fileEditor?: {
    enabled?: boolean;
    restrictedPaths?: string[];
  };
  iconUrl?: string;
  configFiles?: string[];
  [key: string]: any;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  author: string;
  version: string;
  image: string;
  images?: TemplateImageOption[];
  defaultImage?: string;
  installImage?: string;
  startup: string;
  stopCommand: string;
  sendSignalTo: 'SIGTERM' | 'SIGINT' | 'SIGKILL';
  variables: TemplateVariable[];
  installScript?: string;
  supportedPorts: number[];
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  features?: TemplateFeatures;
}
