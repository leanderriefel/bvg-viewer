import {
  Airplane01Icon,
  Building06Icon,
  Cancel01Icon,
  Compass01Icon,
  CubeIcon,
  FootballIcon,
  GaugeIcon,
  Home09Icon,
  Layers01Icon,
  Location01Icon,
  MapsIcon,
  Menu01Icon,
  MinusSignIcon,
  Moon02Icon,
  Navigation03Icon,
  PaintBoardIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  Search01Icon,
  Sun03Icon,
  TreeIcon,
  Target01Icon,
  Tick02Icon,
  InformationCircleIcon,
  Copy01Icon,
  RulerIcon,
  StarIcon,
  WaterEnergyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { LandmarkCategory } from "@/map/landmarks";
import type { SearchResult } from "@/map/search";

/**
 * A single place to pick icons, so the visual language stays consistent and
 * swapping the icon set later is one file rather than thirty imports.
 */

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/** The icon shape `@hugeicons/core-free-icons` exports for every glyph. */
type HugeiconsGlyph = React.ComponentProps<typeof HugeiconsIcon>["icon"];

function make(icon: HugeiconsGlyph) {
  return function Icon({ size = 16, className, strokeWidth = 1.8 }: IconProps) {
    return (
      <HugeiconsIcon
        className={className}
        icon={icon}
        size={size}
        strokeWidth={strokeWidth}
      />
    );
  };
}

export const SearchIcon = make(Search01Icon);
export const CloseIcon = make(Cancel01Icon);
export const MenuIcon = make(Menu01Icon);
export const LayersIcon = make(Layers01Icon);
export const PaletteIcon = make(PaintBoardIcon);
export const CubeIconC = make(CubeIcon);
export const MapFlatIcon = make(MapsIcon);
export const CompassIcon = make(Compass01Icon);
export const NavigateIcon = make(Navigation03Icon);
export const PlusIcon = make(PlusSignIcon);
export const MinusIcon = make(MinusSignIcon);
export const SunIcon = make(Sun03Icon);
export const MoonIcon = make(Moon02Icon);
export const GaugeIconC = make(GaugeIcon);
export const PinIcon = make(Location01Icon);
export const TargetIcon = make(Target01Icon);
export const CheckIcon = make(Tick02Icon);
export const InfoIcon = make(InformationCircleIcon);
export const CopyIcon = make(Copy01Icon);
export const RulerIconC = make(RulerIcon);
export const BuildingIcon = make(Building06Icon);
export const HomeIcon = make(Home09Icon);
export const TreeIconC = make(TreeIcon);
export const WaterIcon = make(WaterEnergyIcon);
export const PlaneIcon = make(Airplane01Icon);
export const StadiumIcon = make(FootballIcon);
export const StarIconC = make(StarIcon);
export const PlayIconC = make(PlayIcon);
export const PauseIconC = make(PauseIcon);

const CATEGORY_ICONS: Record<
  LandmarkCategory,
  (p: IconProps) => React.ReactElement
> = {
  community: BuildingIcon,
  district: HomeIcon,
  icon: StarIconC,
  museum: BuildingIcon,
  park: TreeIconC,
  square: PinIcon,
  stadium: StadiumIcon,
  transport: PlaneIcon,
  water: WaterIcon,
};

export function CategoryIcon({
  category,
  ...rest
}: IconProps & { category: LandmarkCategory }) {
  const Cmp = CATEGORY_ICONS[category] ?? PinIcon;
  return <Cmp {...rest} />;
}

const RESULT_ICONS: Record<
  SearchResult["kind"],
  (p: IconProps) => React.ReactElement
> = {
  address: HomeIcon,
  landmark: StarIconC,
  place: PinIcon,
  street: NavigateIcon,
};

export function ResultIcon({
  kind,
  ...rest
}: IconProps & { kind: SearchResult["kind"] }) {
  const Cmp = RESULT_ICONS[kind] ?? PinIcon;
  return <Cmp {...rest} />;
}
