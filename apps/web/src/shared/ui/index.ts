// Reusable UI pieces (no business rules), organized by Atomic Design:
//   atoms/      smallest building blocks (icon, spinner, switch, link, photo)
//   molecules/  a few atoms working together (alert, segmented control, switch with label)
//   organisms/  self-contained sections (modal)
// Styled with CSS Modules + tokens from styles/tokens.css.
export { CloseButton } from "./atoms/CloseButton";
export { ExternalLink } from "./atoms/ExternalLink";
export { AMENITY_ICON, FEATURE_ICON, Icon, iconSvg, type IconName } from "./atoms/Icon";
export { Photo } from "./atoms/Photo";
export { Spinner } from "./atoms/Spinner";
export { Switch } from "./atoms/Switch";
export { ErrorAlert } from "./molecules/Alert";
export { Segmented, type SegmentedOption } from "./molecules/Segmented";
export { SwitchField } from "./molecules/SwitchField";
export { Modal } from "./organisms/Modal";
