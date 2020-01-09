import java.io.File;
import optifine.Installer;

public class OptiFineInstaller {
    public static void main(String[] args) {
        try {
            Installer.doInstall(
                new File(args[0])
            );
        } catch(Exception e) {
            e.printStackTrace();
        }
    }
}