/**
 * UI kit — single import surface.
 *
 * Two kinds of export:
 *  - Additive kit components (custom or composite) that add behavior/semantics
 *    MUI doesn't provide.
 *  - Themed re-exports of MUI primitives whose look already lives in the theme's
 *    `styleOverrides` (see src/theme/app-theme.ts) — re-exported here so
 *    consumers import everything from one place.
 */

// --- Base ---
export { Panel, type PanelProps } from "./Panel";
export { Tag, type TagProps } from "./Tag";
export { Metric, type MetricProps } from "./Metric";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { KeyHint } from "./KeyHint";
export { StatusDot, type StatusDotProps } from "./StatusDot";
export { IconButton, type IconButtonProps, type IconButtonTone } from "./IconButton";
export { TagSelect, type TagOption } from "./TagSelect";

// --- Overlays & notifications ---
export { Toast, type ToastProps, type ToastSeverity } from "./Toast";
export { ToastProvider, useToast, type ToastOptions } from "./ToastProvider";

// --- Data & state ---
export { Timeline, type TimelineItem, type TimelineProps } from "./Timeline";
export { DataTable, type DataColumn, type DataTableProps } from "./DataTable";

// --- Themed MUI re-exports ---
export {
  Box,
  Button,
  type ButtonProps,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  LinearProgress,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
