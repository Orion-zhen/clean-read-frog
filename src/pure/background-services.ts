function unavailable(name: string): never {
  throw new Error(`${name} is unavailable in the pure distribution`)
}

export function setupHostedAiStatusHandler(): never {
  return unavailable("Hosted AI")
}

export function clearHostedAiStatusCache(): void {
  // No hosted status exists in pure builds.
}

export function setupNotebasePendingSaveProcessor(): never {
  return unavailable("Notebase")
}
