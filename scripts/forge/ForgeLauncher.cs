/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Forge Launcher")]
[assembly: AssemblyDescription("Console-free launcher for Forge AI IDE")]
[assembly: AssemblyCompany("Forge")]
[assembly: AssemblyProduct("Forge AI IDE")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class ForgeLauncher
{
	[STAThread]
	private static int Main(string[] arguments)
	{
		try
		{
			string forgeRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
			string packagedExecutable = FindPackagedExecutable(forgeRoot);
			string developmentExecutable = Path.Combine(forgeRoot, ".build", "electron", "Forge.exe");
			bool usePackaged = File.Exists(packagedExecutable);
			string forgeExecutable = usePackaged ? packagedExecutable : developmentExecutable;

			if (!File.Exists(forgeExecutable))
			{
				MessageBox.Show(
					"Forge is not ready to start from this source tree.\r\n\r\n" +
					"Missing packaged app:\r\n" + Relativize(forgeRoot, packagedExecutable) + "\r\n\r\n" +
					"Missing development runtime:\r\n.build\\electron\\Forge.exe\r\n\r\n" +
					"Use the installed Forge app, run gulp vscode-win32-x64, or run npm run electron first.",
					"Forge",
					MessageBoxButtons.OK,
					MessageBoxIcon.Error);
				return 1;
			}

			if (!usePackaged)
			{
				string error = ValidateDevelopmentRuntime(forgeRoot);
				if (error != null)
				{
					MessageBox.Show(error, "Forge", MessageBoxButtons.OK, MessageBoxIcon.Error);
					return 1;
				}
			}

			string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
			string forgeCodexHome = Path.Combine(userProfile, ".forge", "codex");
			Directory.CreateDirectory(forgeCodexHome);
			CopyIfMissing(Path.Combine(userProfile, ".codex", "auth.json"), Path.Combine(forgeCodexHome, "auth.json"));
			CopyIfMissing(Path.Combine(userProfile, ".codex", "config.toml"), Path.Combine(forgeCodexHome, "config.toml"));

			ProcessStartInfo startInfo = new ProcessStartInfo();
			startInfo.FileName = forgeExecutable;
			startInfo.WorkingDirectory = usePackaged ? Path.GetDirectoryName(forgeExecutable) : forgeRoot;
			startInfo.Arguments = usePackaged ? BuildArguments(arguments, false) : BuildArguments(arguments, true);
			startInfo.UseShellExecute = false;
			startInfo.CreateNoWindow = true;
			startInfo.WindowStyle = ProcessWindowStyle.Normal;
			startInfo.EnvironmentVariables["VSCODE_AGENT_HOST_CODEX_AGENT_ENABLED"] = "true";
			startInfo.EnvironmentVariables["CODEX_HOME"] = forgeCodexHome;

			if (!usePackaged)
			{
				startInfo.EnvironmentVariables["NODE_ENV"] = "development";
				startInfo.EnvironmentVariables["VSCODE_DEV"] = "1";
				startInfo.EnvironmentVariables["VSCODE_CLI"] = "1";
				startInfo.EnvironmentVariables["ELECTRON_ENABLE_LOGGING"] = "1";
				startInfo.EnvironmentVariables["ELECTRON_ENABLE_STACK_DUMPING"] = "1";
				string sdkCodexExecutable = Path.Combine(forgeRoot, ".build", "forge-codex-sdk", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
				if (File.Exists(sdkCodexExecutable))
				{
					startInfo.EnvironmentVariables["VSCODE_AGENT_HOST_CODEX_SDK_ROOT"] = Path.Combine(forgeRoot, ".build", "forge-codex-sdk");
				}
			}

			Process.Start(startInfo);
			return 0;
		}
		catch (Exception error)
		{
			MessageBox.Show(
				"Forge failed to start.\r\n\r\n" + error.Message,
				"Forge",
				MessageBoxButtons.OK,
				MessageBoxIcon.Error);
			return 1;
		}
	}

	private static string FindPackagedExecutable(string forgeRoot)
	{
		string[] candidates =
		{
			Path.Combine(forgeRoot, ".build", "VSCode-win32-x64", "Forge.exe"),
			Path.Combine(forgeRoot, ".build", "VSCode-win32-arm64", "Forge.exe")
		};
		foreach (string candidate in candidates)
		{
			if (File.Exists(candidate))
			{
				return Path.GetFullPath(candidate);
			}
		}
		return Path.GetFullPath(candidates[0]);
	}

	private static string ValidateDevelopmentRuntime(string forgeRoot)
	{
		List<string> missingFiles = new List<string>();
		AddIfMissing(missingFiles, Path.Combine(forgeRoot, "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"), "embedded Codex executable");
		AddIfMissing(missingFiles, Path.Combine(forgeRoot, "node_modules", "@vscode", "sqlite3", "build", "Release", "vscode-sqlite3.node"), "embedded SQLite module");
		AddIfMissing(missingFiles, Path.Combine(forgeRoot, "out", "main.js"), "compiled workbench output");
		if (missingFiles.Count == 0)
		{
			return null;
		}
		return "Forge's development runtime is incomplete.\r\n\r\nMissing: " + string.Join(", ", missingFiles.ToArray()) + "\r\n\r\nRestore the complete forge directory, or start .build\\VSCode-win32-x64\\Forge.exe after packaging.";
	}

	private static void AddIfMissing(List<string> missingFiles, string path, string label)
	{
		if (!File.Exists(path))
		{
			missingFiles.Add(label);
		}
	}

	private static void CopyIfMissing(string source, string destination)
	{
		if (!File.Exists(destination) && File.Exists(source))
		{
			File.Copy(source, destination, false);
		}
	}

	private static string Relativize(string forgeRoot, string path)
	{
		string fullRoot = Path.GetFullPath(forgeRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
		string fullPath = Path.GetFullPath(path);
		if (fullPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
		{
			return fullPath.Substring(fullRoot.Length);
		}
		string parent = Path.GetDirectoryName(forgeRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
		if (!string.IsNullOrEmpty(parent))
		{
			string fullParent = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
			if (fullPath.StartsWith(fullParent, StringComparison.OrdinalIgnoreCase))
			{
				return ".." + Path.DirectorySeparatorChar + fullPath.Substring(fullParent.Length);
			}
		}
		return fullPath;
	}

	private static string BuildArguments(string[] arguments, bool development)
	{
		StringBuilder result = new StringBuilder(development ? ". --disable-extension=vscode.vscode-api-tests" : "");
		foreach (string argument in arguments)
		{
			if (result.Length > 0)
			{
				result.Append(' ');
			}
			result.Append(QuoteArgument(argument));
		}
		return result.ToString();
	}

	private static string QuoteArgument(string argument)
	{
		if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
		{
			return argument;
		}

		StringBuilder result = new StringBuilder();
		result.Append('"');
		int backslashes = 0;
		foreach (char character in argument)
		{
			if (character == '\\')
			{
				backslashes++;
				continue;
			}
			if (character == '"')
			{
				result.Append('\\', backslashes * 2 + 1);
				result.Append('"');
				backslashes = 0;
				continue;
			}
			result.Append('\\', backslashes);
			backslashes = 0;
			result.Append(character);
		}
		result.Append('\\', backslashes * 2);
		result.Append('"');
		return result.ToString();
	}
}
