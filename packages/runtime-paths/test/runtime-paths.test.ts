import { describe, expect, it } from 'vitest';
import { resolveDataRoot, DataRootError } from '../src/index';

describe('resolveDataRoot', () => {
  it('keeps installed data in OS user profile', () => {
    expect(resolveDataRoot({ distributionMode: 'installed', exeDirectory: 'C:\\Program Files\\USSM', osUserDataDirectory: 'C:\\Users\\中文 用户\\AppData\\Roaming\\USSM' }))
      .toBe('C:\\Users\\中文 用户\\AppData\\Roaming\\USSM');
  });
  it('uses external portable EXE directory rather than unpacked temp', () => {
    expect(resolveDataRoot({ distributionMode: 'portable-exe', exeDirectory: 'C:\\Users\\X\\AppData\\Local\\Temp\\bundle', portableExternalDirectory: 'D:\\我的 工具\\软件', osUserDataDirectory: 'C:\\Users\\X\\AppData\\Roaming' }))
      .toBe('D:\\我的 工具\\软件\\Data');
  });
  it('uses the unpacked ZIP executable directory', () => {
    expect(resolveDataRoot({ distributionMode: 'portable-zip', exeDirectory: 'E:\\工具 ZIP\\目录', osUserDataDirectory: 'C:\\Users\\X\\AppData\\Roaming' }))
      .toBe('E:\\工具 ZIP\\目录\\Data');
  });
  it('fails closed when external portable dir is absent or equals unpacked dir', () => {
    const input = { distributionMode: 'portable-exe' as const, exeDirectory: 'C:\\Temp\\unpack', osUserDataDirectory: 'C:\\Users\\X\\AppData\\Roaming' };
    expect(() => resolveDataRoot(input)).toThrowError(DataRootError);
    expect(() => resolveDataRoot({ ...input, portableExternalDirectory: input.exeDirectory }))
      .toThrowError(/matches the unpacked/);
  });
});
