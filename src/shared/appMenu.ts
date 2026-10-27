/** The application menu as data, for the renderer's title bar (the window has no native menu bar). Built by main from the same template as the native menu (accelerators keep working). */
export interface AppMenuItem {
  /** Path in the template (`0.2`); what `invokeAppMenu` takes. */
  id: string
  label: string
  separator?: boolean
  enabled?: boolean
  /** Shown right-aligned, e.g. `Ctrl+S`. */
  accelerator?: string
  /** Second line of a row (Open Recent: the project folder). */
  sublabel?: string
  submenu?: AppMenuItem[]
}
export type AppMenu = AppMenuItem[]
