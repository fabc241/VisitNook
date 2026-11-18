import ExpoModulesCore
import Foundation

final class InvalidPathException: GenericException<String> {
  override var reason: String {
    "Not a valid local file path or file:// URL: \(param)"
  }
}

final class InvalidProtectionClassException: GenericException<String> {
  override var reason: String {
    "Unknown protection class '\(param)'. Use complete, completeUnlessOpen, completeUntilFirstUserAuthentication or none."
  }
}

/// Sets iOS Data Protection classes and the "exclude from backup" flag on files
/// and folders. A folder's protection class becomes the default for files that
/// are created inside it later.
public final class FileProtectionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FileProtection")

    AsyncFunction("setProtection") { (path: String, protection: String) in
      let url = try Self.fileURL(path)
      let value = try Self.protectionType(protection)
      try FileManager.default.setAttributes([.protectionKey: value], ofItemAtPath: url.path)
    }

    AsyncFunction("getProtection") { (path: String) -> String? in
      let url = try Self.fileURL(path)
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      guard let value = attributes[.protectionKey] as? FileProtectionType else {
        return nil
      }
      return Self.protectionName(value)
    }

    AsyncFunction("excludeFromBackup") { (path: String) in
      var url = try Self.fileURL(path)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }

    AsyncFunction("isExcludedFromBackup") { (path: String) -> Bool in
      let url = try Self.fileURL(path)
      let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
      return values.isExcludedFromBackup ?? false
    }
  }

  private static func fileURL(_ path: String) throws -> URL {
    if path.hasPrefix("file://") {
      guard let url = URL(string: path), url.isFileURL else {
        throw InvalidPathException(path)
      }
      return url
    }
    guard path.hasPrefix("/") else {
      throw InvalidPathException(path)
    }
    return URL(fileURLWithPath: path)
  }

  private static func protectionType(_ name: String) throws -> FileProtectionType {
    switch name {
    case "complete": return .complete
    case "completeUnlessOpen": return .completeUnlessOpen
    case "completeUntilFirstUserAuthentication": return .completeUntilFirstUserAuthentication
    case "none": return .none
    default: throw InvalidProtectionClassException(name)
    }
  }

  private static func protectionName(_ value: FileProtectionType) -> String {
    switch value {
    case .complete: return "complete"
    case .completeUnlessOpen: return "completeUnlessOpen"
    case .completeUntilFirstUserAuthentication: return "completeUntilFirstUserAuthentication"
    case .none: return "none"
    default: return value.rawValue
    }
  }
}
