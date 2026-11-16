import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import './styles.css';
import { applyStatic } from './i18n';
import { hideLoading, setLoadingText } from './ui/loading';
import { showTitleCard } from './ui/titlecard';
import { flags } from './flags';

setLoadingText();
applyStatic();
hideLoading();
if (!flags.skipIntro) showTitleCard({ onExplore: () => {}, onSkip: () => {} });
document.body.dataset.ready = '1';
