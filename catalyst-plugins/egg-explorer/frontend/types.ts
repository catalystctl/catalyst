// src/plugins/egg-explorer/types.ts

export interface EggVariable {
  name: string;
  description: string;
  default: string;
  required: boolean;
}

export interface EggSummary {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  categoryName: string;
  subcategory: string | null;
  subcategoryName: string | null;
  imageFamily: string;
  images: string[];
  features: string[];
  variableCount: number;
  variables: EggVariable[];
  startup: string;
  installImage: string | null;
  stopCommand: string | null;
  hasInstallScript: boolean;
  enriched: boolean;
}

export interface EggCategory {
  id: string;
  name: string;
  count: number;
  subcategories: Array<{ id: string; name: string }>;
  imageFamilies: string[];
}

export interface EggIndexStatus {
  ready: boolean;
  syncing: boolean;
  totalEggs: number;
  totalCategories: number;
  enriched: number;
  hasToken: boolean;
  lastSync: string | null;
}

export interface EggListResponse {
  success: boolean;
  data: EggSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
