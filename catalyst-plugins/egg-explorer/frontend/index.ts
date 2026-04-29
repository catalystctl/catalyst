import { createFrontendPlugin } from '@/plugins/plugin-definition';
import { EggExplorer } from './components/EggExplorer';

export default createFrontendPlugin({
  manifest: {
    name: 'egg-explorer',
    version: '2.0.0',
    displayName: 'Egg Explorer',
    description:
      'Browse and install game server templates from the Pterodactyl game-eggs repository directly from the admin panel',
    author: 'Karutoil',
  },
  tabs: [
    {
      id: 'egg-explorer',
      label: 'Egg Explorer',
      component: EggExplorer,
      location: 'admin',
      order: 50,
      requiredPermissions: ['admin.read'],
    },
  ],
});
